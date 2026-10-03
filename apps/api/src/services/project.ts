import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { projectMembers, projects, projectSkills, skills } from "../db/schema";
import type { CreateProjectInput } from "@connect-create/shared";
import { ensureSkillIds, normalizeTags } from "./profile";

export type ProjectView = {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  category: string;
  status: string;
  skillsNeeded: string[];
  createdAt: string;
  lastActivityAt: string;
};

export async function getSkillsForProjects(db: Db, projectIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (projectIds.length === 0) return map;
  const rows = await db
    .select({ projectId: projectSkills.projectId, name: skills.name })
    .from(projectSkills)
    .innerJoin(skills, eq(projectSkills.skillId, skills.id))
    .where(inArray(projectSkills.projectId, projectIds));
  for (const row of rows) {
    const list = map.get(row.projectId) ?? [];
    list.push(row.name);
    map.set(row.projectId, list);
  }
  return map;
}

export function toProjectView(p: typeof projects.$inferSelect, skillsNeeded: string[]): ProjectView {
  return {
    id: p.id,
    ownerId: p.ownerId,
    title: p.title,
    description: p.description,
    category: p.category,
    status: p.status,
    skillsNeeded,
    createdAt: p.createdAt.toISOString(),
    lastActivityAt: p.lastActivityAt.toISOString(),
  };
}

export type CreateProjectResult =
  | { ok: true; id: string }
  | { ok: false; error: "duplicate_skills" };

export async function createProject(
  db: Db,
  ownerId: string,
  input: CreateProjectInput,
): Promise<CreateProjectResult> {
  const normalized = normalizeTags(input.skillsNeeded);
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, error: "duplicate_skills" };
  }

  const [project] = await db
    .insert(projects)
    .values({
      ownerId,
      title: input.title,
      description: input.description,
      category: input.category,
    })
    .returning({ id: projects.id });
  if (!project) throw new Error("insert failed");

  await db.insert(projectMembers).values({ projectId: project.id, userId: ownerId, role: "owner" });

  const skillIds = await ensureSkillIds(db, normalized);
  if (skillIds.length > 0) {
    await db.insert(projectSkills).values(skillIds.map((skillId) => ({ projectId: project.id, skillId })));
  }

  return { ok: true, id: project.id };
}

export async function getProject(db: Db, id: string): Promise<ProjectView | null> {
  const [project] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) return null;
  const skillMap = await getSkillsForProjects(db, [project.id]);
  return toProjectView(project, skillMap.get(project.id) ?? []);
}

export async function isProjectMember(db: Db, projectId: string, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  return !!row;
}

export const LIST_PAGE_SIZE = 20;

export type ListProjectsFilter = {
  skills?: string[];
  category?: string;
  cursor?: string;
};

export async function listProjects(
  db: Db,
  filter: ListProjectsFilter,
): Promise<{ items: ProjectView[]; nextCursor: string | null }> {
  const offset = filter.cursor ? Number.parseInt(filter.cursor, 10) : 0;
  const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;

  const conditions = [];
  if (filter.category) conditions.push(eq(projects.category, filter.category));
  if (filter.skills && filter.skills.length > 0) {
    const matching = db
      .select({ projectId: projectSkills.projectId })
      .from(projectSkills)
      .innerJoin(skills, eq(projectSkills.skillId, skills.id))
      .where(inArray(skills.name, filter.skills));
    conditions.push(inArray(projects.id, matching));
  }

  const rows = await db
    .select()
    .from(projects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.lastActivityAt), desc(projects.id))
    .limit(LIST_PAGE_SIZE + 1)
    .offset(safeOffset);

  const page = rows.slice(0, LIST_PAGE_SIZE);
  const hasMore = rows.length > LIST_PAGE_SIZE;
  const skillMap = await getSkillsForProjects(db, page.map((r) => r.id));

  return {
    items: page.map((r) => toProjectView(r, skillMap.get(r.id) ?? [])),
    nextCursor: hasMore ? String(safeOffset + LIST_PAGE_SIZE) : null,
  };
}
