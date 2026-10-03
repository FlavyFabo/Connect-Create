import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { milestones, progressEvents, projects } from "../db/schema";
import { progressConfig } from "../config";

export type ScoreEvent = {
  milestoneId: string | null;
  userId: string;
  projectId: string;
  type: "milestone_done" | "milestone_confirmed" | "evidence_voided";
  weight: number;
  createdAt: Date;
};

export type ProgressScores = {
  projectScores: Map<string, number>;
  userScores: Map<string, number>;
};

export function computeProgress(events: ScoreEvent[], now: Date = new Date()): ProgressScores {
  const latest = new Map<string, ScoreEvent>();
  for (const e of events) {
    if (!e.milestoneId) continue;
    const prev = latest.get(e.milestoneId);
    if (!prev || prev.createdAt <= e.createdAt) latest.set(e.milestoneId, e);
  }

  const byProjectDay = new Map<string, ScoreEvent[]>();
  for (const e of latest.values()) {
    const day = e.createdAt.toISOString().slice(0, 10);
    const key = `${e.projectId}|${day}`;
    const group = byProjectDay.get(key);
    if (group) group.push(e);
    else byProjectDay.set(key, [e]);
  }

  const projectScores = new Map<string, number>();
  const userScores = new Map<string, number>();
  for (const group of byProjectDay.values()) {
    const counted = [...group]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, progressConfig.maxCountedPerProjectPerDay);
    for (const e of counted) {
      const ageDays = (now.getTime() - e.createdAt.getTime()) / 86_400_000;
      const decayed = e.weight * Math.pow(0.5, ageDays / progressConfig.decayHalfLifeDays);
      projectScores.set(e.projectId, (projectScores.get(e.projectId) ?? 0) + decayed);
      userScores.set(e.userId, (userScores.get(e.userId) ?? 0) + decayed);
    }
  }
  return { projectScores, userScores };
}

export async function getUserProgress(db: Db, userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.userId, userId))
    .orderBy(asc(progressEvents.createdAt));
  const { userScores } = computeProgress(rows.map(toScoreEvent));
  return userScores.get(userId) ?? 0;
}

export type ProjectProgressView = {
  score: number;
  milestonesDone: number;
  milestonesConfirmed: number;
  milestonesTotal: number;
  lastActivityAt: string;
};

export async function getProjectProgress(db: Db, projectId: string): Promise<ProjectProgressView | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const rows = await db
    .select()
    .from(progressEvents)
    .where(eq(progressEvents.projectId, projectId))
    .orderBy(asc(progressEvents.createdAt));
  const { projectScores } = computeProgress(rows.map(toScoreEvent));

  const ms = await db.select({ state: milestones.state }).from(milestones).where(eq(milestones.projectId, projectId));
  return {
    score: projectScores.get(projectId) ?? 0,
    milestonesDone: ms.filter((m) => m.state === "done").length,
    milestonesConfirmed: ms.filter((m) => m.state === "confirmed").length,
    milestonesTotal: ms.length,
    lastActivityAt: project.lastActivityAt.toISOString(),
  };
}

function toScoreEvent(row: typeof progressEvents.$inferSelect): ScoreEvent {
  return {
    milestoneId: row.milestoneId,
    userId: row.userId,
    projectId: row.projectId,
    type: row.type,
    weight: Number(row.weight),
    createdAt: row.createdAt,
  };
}
