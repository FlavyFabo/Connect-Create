import { asc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import {
  joinRequests,
  profiles,
  progressEvents,
  projects,
  projectMembers,
  users,
} from "../db/schema";
import { matchingConfig } from "../config";
import { getSkillsForUsers } from "./profile";
import { getSkillsForProjects, toProjectView, type ProjectView } from "./project";
import { computeProgress } from "./progress";

const W = matchingConfig.weights;

export function skillFit(needed: string[], offered: string[]): number {
  if (needed.length === 0) return 0;
  const offeredSet = new Set(offered);
  return needed.filter((s) => offeredSet.has(s)).length / needed.length;
}

export function sharedSkills(needed: string[], offered: string[]): string[] {
  const offeredSet = new Set(offered);
  return needed.filter((s) => offeredSet.has(s));
}

export function availabilityOverlap(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 || setB.size === 0) return 0.5;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  return inter / (setA.size + setB.size - inter);
}

export function matchScore(parts: {
  skillFit: number;
  progress: number;
  userProgress: number;
  availability: number;
}): number {
  return (
    W.skillFit * parts.skillFit +
    W.progress * parts.progress +
    W.userProgress * parts.userProgress +
    W.availability * parts.availability
  );
}

export function seededRank(id: string, seed: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (const c of `${seed}:${id}`) {
    h = (h ^ c.charCodeAt(0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

export function normalizeScore(score: number, maxScore: number): number {
  return maxScore > 0 ? score / maxScore : 0;
}

function withinBaseline(createdAt: Date, now: Date): boolean {
  const ageMs = now.getTime() - createdAt.getTime();
  return ageMs < matchingConfig.baselineDays * 86_400_000;
}

async function allScores(db: Db) {
  const rows = await db.select().from(progressEvents).orderBy(asc(progressEvents.createdAt));
  return computeProgress(
    rows.map((r) => ({
      milestoneId: r.milestoneId,
      userId: r.userId,
      projectId: r.projectId,
      type: r.type,
      weight: Number(r.weight),
      createdAt: r.createdAt,
    })),
  );
}

export type MatchedProject = {
  project: ProjectView;
  matchScore: number;
  reasons: { sharedSkills: string[]; lastActivityAt: string };
};

export async function rankProjectsForUser(
  db: Db,
  viewer: { id: string; skills: string[]; availability: string[] },
  seed: number,
): Promise<MatchedProject[]> {
  const memberRows = await db
    .select({ projectId: projectMembers.projectId })
    .from(projectMembers)
    .where(eq(projectMembers.userId, viewer.id));
  const memberIds = new Set(memberRows.map((r) => r.projectId));

  const rows = await db
    .select()
    .from(projects)
    .where(eq(projects.status, "open"));
  const candidates = rows.filter((p) => !memberIds.has(p.id));
  if (candidates.length === 0) return [];

  const { projectScores, userScores } = await allScores(db);
  const maxProjectScore = Math.max(0, ...candidates.map((p) => projectScores.get(p.id) ?? 0));
  const viewerScore = userScores.get(viewer.id) ?? 0;
  const maxUserScore = Math.max(0, ...[...userScores.values()]);
  const [viewerUser] = await db.select().from(users).where(eq(users.id, viewer.id)).limit(1);

  const ownerProfiles = await db.select().from(profiles).where(inArray(profiles.userId, candidates.map((p) => p.ownerId)));
  const ownerAvailMap = new Map(ownerProfiles.map((p) => [p.userId, p.availability]));

  const skillMap = await getSkillsForProjects(db, candidates.map((p) => p.id));
  const now = new Date();

  const scored: MatchedProject[] = candidates.map((p) => {
    const needed = skillMap.get(p.id) ?? [];
    const fit = skillFit(needed, viewer.skills);
    const progress = withinBaseline(p.createdAt, now)
      ? matchingConfig.baselineProgress
      : normalizeScore(projectScores.get(p.id) ?? 0, maxProjectScore);
    const userProgress =
      viewerUser && withinBaseline(viewerUser.createdAt, now)
        ? matchingConfig.baselineProgress
        : normalizeScore(viewerScore, maxUserScore);
    const availability = availabilityOverlap(viewer.availability, ownerAvailMap.get(p.ownerId) ?? []);
    const score = matchScore({ skillFit: fit, progress, userProgress, availability });
    return {
      project: toProjectView(p, needed),
      matchScore: score,
      reasons: { sharedSkills: sharedSkills(needed, viewer.skills), lastActivityAt: p.lastActivityAt.toISOString() },
    };
  });

  scored.sort(
    (a, b) =>
      b.matchScore - a.matchScore ||
      b.project.lastActivityAt.localeCompare(a.project.lastActivityAt) ||
      seededRank(b.project.id, seed) - seededRank(a.project.id, seed),
  );
  return scored;
}

export type MatchedCandidate = {
  user: { id: string; name: string; skills: string[]; availability: string[] };
  matchScore: number;
  reasons: { sharedSkills: string[] };
};

export async function rankCandidatesForProject(
  db: Db,
  projectId: string,
  seed: number,
): Promise<MatchedCandidate[]> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return [];

  const memberRows = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(eq(projectMembers.projectId, projectId));
  const memberIds = new Set(memberRows.map((r) => r.userId));

  const allUsers = await db.select().from(users);
  const candidates = allUsers.filter((u) => !memberIds.has(u.id));
  if (candidates.length === 0) return [];

  const skillMap = await getSkillsForProjects(db, [projectId]);
  const needed = skillMap.get(projectId) ?? [];
  const { projectScores, userScores } = await allScores(db);
  const maxUserScore = Math.max(0, ...candidates.map((u) => userScores.get(u.id) ?? 0));
  const maxProjectScore = Math.max(0, ...projectScores.values());
  const now = new Date();
  const projectProgress = withinBaseline(project.createdAt, now)
    ? matchingConfig.baselineProgress
    : normalizeScore(projectScores.get(projectId) ?? 0, maxProjectScore);

  const profileRows = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.userId, candidates.map((u) => u.id)));
  const profileMap = new Map(profileRows.map((p) => [p.userId, p]));
  const candidateSkills = await getSkillsForUsers(db, candidates.map((u) => u.id));
  const [ownerProfile] = await db.select().from(profiles).where(eq(profiles.userId, project.ownerId)).limit(1);
  const ownerAvailability = ownerProfile?.availability ?? [];

  const scored: MatchedCandidate[] = candidates.map((u) => {
    const offered = candidateSkills.get(u.id) ?? [];
    const fit = skillFit(needed, offered);
    const userProgress = withinBaseline(u.createdAt, now)
      ? matchingConfig.baselineProgress
      : normalizeScore(userScores.get(u.id) ?? 0, maxUserScore);
    const availability = availabilityOverlap(profileMap.get(u.id)?.availability ?? [], ownerAvailability);
    const score = matchScore({ skillFit: fit, progress: projectProgress, userProgress, availability });
    return {
      user: {
        id: u.id,
        name: u.name,
        skills: offered,
        availability: profileMap.get(u.id)?.availability ?? [],
      },
      matchScore: score,
      reasons: { sharedSkills: sharedSkills(needed, offered) },
    };
  });

  scored.sort(
    (a, b) => b.matchScore - a.matchScore || seededRank(b.user.id, seed) - seededRank(a.user.id, seed),
  );
  return scored;
}

export async function needsFirstCollaborator(db: Db): Promise<ProjectView[]> {
  const cutoff = new Date(Date.now() - matchingConfig.needsFirstCollaboratorDays * 86_400_000);
  const withResponses = db
    .select({ projectId: joinRequests.projectId })
    .from(joinRequests);
  const rows = await db
    .select()
    .from(projects)
    .where(
      sql`${projects.status} != 'done' AND ${projects.createdAt} <= ${cutoff} AND ${projects.id} NOT IN (${withResponses})`,
    );
  const skillMap = await getSkillsForProjects(db, rows.map((r) => r.id));
  return rows.map((r) => toProjectView(r, skillMap.get(r.id) ?? []));
}
