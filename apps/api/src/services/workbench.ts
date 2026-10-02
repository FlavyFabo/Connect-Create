import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { evidence, milestones, notes, progressEvents, projects } from "../db/schema";
import type { EvidenceInput } from "@connect-create/shared";

async function touchProject(db: Db, projectId: string): Promise<void> {
  await db.update(projects).set({ lastActivityAt: new Date() }).where(eq(projects.id, projectId));
}

export type MilestoneView = {
  id: string;
  title: string;
  state: string;
  evidence: { id: string; type: string; content: string } | null;
  completedBy: string | null;
  confirmedBy: string | null;
  createdAt: string;
};

export type NoteView = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

type MilestoneRow = typeof milestones.$inferSelect;

async function toMilestoneView(db: Db, m: MilestoneRow): Promise<MilestoneView> {
  const ev = await db.select().from(evidence).where(eq(evidence.milestoneId, m.id)).limit(1);
  const e = ev[0];
  return {
    id: m.id,
    title: m.title,
    state: m.state,
    evidence: e ? { id: e.id, type: e.type, content: e.content } : null,
    completedBy: m.completedBy,
    confirmedBy: m.confirmedBy,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function getWorkbench(
  db: Db,
  projectId: string,
): Promise<{ milestones: MilestoneView[]; notes: NoteView[] }> {
  const ms = await db
    .select()
    .from(milestones)
    .where(eq(milestones.projectId, projectId))
    .orderBy(asc(milestones.position), asc(milestones.createdAt));
  const ns = await db.select().from(notes).where(eq(notes.projectId, projectId)).orderBy(asc(notes.createdAt));
  return {
    milestones: await Promise.all(ms.map((m) => toMilestoneView(db, m))),
    notes: ns.map((n) => ({ id: n.id, authorId: n.authorId, body: n.body, createdAt: n.createdAt.toISOString() })),
  };
}

export async function createMilestone(
  db: Db,
  projectId: string,
  title: string,
): Promise<MilestoneView> {
  const [row] = await db.insert(milestones).values({ projectId, title }).returning();
  if (!row) throw new Error("insert failed");
  await touchProject(db, projectId);
  return toMilestoneView(db, row);
}

export async function getMilestoneById(db: Db, id: string): Promise<MilestoneRow | null> {
  const [row] = await db.select().from(milestones).where(eq(milestones.id, id)).limit(1);
  return row ?? null;
}

async function recordEvent(
  db: Db,
  input: { userId: string; projectId: string; milestoneId: string; type: "milestone_done" | "milestone_confirmed" | "evidence_voided"; weight: number },
): Promise<void> {
  await db.insert(progressEvents).values({
    userId: input.userId,
    projectId: input.projectId,
    milestoneId: input.milestoneId,
    type: input.type,
    weight: String(input.weight),
  });
}

export type UpdateMilestoneResult =
  | { ok: true; milestone: MilestoneView }
  | { ok: false; error: "invalid_transition" };

export async function updateMilestone(
  db: Db,
  milestone: MilestoneRow,
  userId: string,
  input: { title?: string | undefined; state?: "todo" | "done" | undefined; evidence?: EvidenceInput | null | undefined },
): Promise<UpdateMilestoneResult> {
  if (milestone.state === "confirmed") {
    return { ok: false, error: "invalid_transition" };
  }

  if (input.title !== undefined) {
    await db.update(milestones).set({ title: input.title }).where(eq(milestones.id, milestone.id));
  }

  if (input.state === "done") {
    const now = new Date();
    await db
      .update(milestones)
      .set({ state: "done", completedBy: userId, completedAt: now })
      .where(eq(milestones.id, milestone.id));
    if (input.evidence) {
      await db.delete(evidence).where(eq(evidence.milestoneId, milestone.id));
      await db.insert(evidence).values({
        milestoneId: milestone.id,
        type: input.evidence.type,
        content: input.evidence.content,
      });
    }
    await recordEvent(db, {
      userId,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      type: "milestone_done",
      weight: input.evidence ? 0.5 : 0,
    });
  } else if (input.state === "todo") {
    await db
      .update(milestones)
      .set({ state: "todo", completedBy: null, completedAt: null })
      .where(eq(milestones.id, milestone.id));
    await db.delete(evidence).where(eq(evidence.milestoneId, milestone.id));
    await recordEvent(db, {
      userId,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      type: "evidence_voided",
      weight: 0,
    });
  } else if (input.evidence === null && milestone.state === "done") {
    await db.delete(evidence).where(eq(evidence.milestoneId, milestone.id));
    await recordEvent(db, {
      userId,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      type: "evidence_voided",
      weight: 0,
    });
  } else if (input.evidence && milestone.state === "done") {
    await db.delete(evidence).where(eq(evidence.milestoneId, milestone.id));
    await db.insert(evidence).values({
      milestoneId: milestone.id,
      type: input.evidence.type,
      content: input.evidence.content,
    });
    await recordEvent(db, {
      userId,
      projectId: milestone.projectId,
      milestoneId: milestone.id,
      type: "milestone_done",
      weight: 0.5,
    });
  }

  await touchProject(db, milestone.projectId);
  const [fresh] = await db.select().from(milestones).where(eq(milestones.id, milestone.id)).limit(1);
  return { ok: true, milestone: await toMilestoneView(db, fresh!) };
}

export async function deleteMilestone(db: Db, milestone: MilestoneRow): Promise<void> {
  await db.delete(milestones).where(eq(milestones.id, milestone.id));
  await touchProject(db, milestone.projectId);
}

export type ConfirmResult =
  | { ok: true; milestone: MilestoneView }
  | { ok: false; error: "not_done" | "self_confirm" };

export async function confirmMilestone(
  db: Db,
  milestone: MilestoneRow,
  userId: string,
): Promise<ConfirmResult> {
  if (milestone.state !== "done") {
    return { ok: false, error: "not_done" };
  }
  if (milestone.completedBy === userId) {
    return { ok: false, error: "self_confirm" };
  }
  const now = new Date();
  await db
    .update(milestones)
    .set({ state: "confirmed", confirmedBy: userId, confirmedAt: now })
    .where(eq(milestones.id, milestone.id));
  await recordEvent(db, {
    userId,
    projectId: milestone.projectId,
    milestoneId: milestone.id,
    type: "milestone_confirmed",
    weight: 1.0,
  });
  await touchProject(db, milestone.projectId);
  const [fresh] = await db.select().from(milestones).where(eq(milestones.id, milestone.id)).limit(1);
  return { ok: true, milestone: await toMilestoneView(db, fresh!) };
}

export async function addNote(db: Db, projectId: string, authorId: string, body: string): Promise<NoteView> {
  const [row] = await db.insert(notes).values({ projectId, authorId, body }).returning();
  if (!row) throw new Error("insert failed");
  await touchProject(db, projectId);
  return { id: row.id, authorId: row.authorId, body: row.body, createdAt: row.createdAt.toISOString() };
}
