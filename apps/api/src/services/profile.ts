import { eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { profileSkills, profiles, skills } from "../db/schema";

export type ProfileView = {
  skills: string[];
  interests: string[];
  availability: string[];
};

export function normalizeTags(tags: string[]): string[] {
  return tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
}

export async function getProfile(db: Db, userId: string): Promise<ProfileView> {
  const [profile] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const skillRows = await db
    .select({ name: skills.name })
    .from(profileSkills)
    .innerJoin(skills, eq(profileSkills.skillId, skills.id))
    .where(eq(profileSkills.userId, userId));
  return {
    skills: skillRows.map((r) => r.name),
    interests: profile?.interests ?? [],
    availability: profile?.availability ?? [],
  };
}

export async function ensureSkillIds(db: Db, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of names) {
    const [row] = await db
      .insert(skills)
      .values({ name })
      .onConflictDoNothing({ target: skills.name })
      .returning({ id: skills.id });
    if (row) {
      ids.push(row.id);
      continue;
    }
    const [existing] = await db.select({ id: skills.id }).from(skills).where(eq(skills.name, name)).limit(1);
    if (!existing) throw new Error(`skill upsert failed for ${name}`);
    ids.push(existing.id);
  }
  return ids;
}

export type UpdateProfileResult =
  | { ok: true; profile: ProfileView }
  | { ok: false; error: "duplicate_skills" };

export async function updateProfile(
  db: Db,
  userId: string,
  input: { skills: string[]; interests: string[]; availability: string[] },
): Promise<UpdateProfileResult> {
  const normalized = normalizeTags(input.skills);
  if (new Set(normalized).size !== normalized.length) {
    return { ok: false, error: "duplicate_skills" };
  }

  await db.insert(profiles).values({ userId }).onConflictDoNothing();
  const skillIds = await ensureSkillIds(db, normalized);

  await db
    .update(profiles)
    .set({ interests: input.interests, availability: input.availability })
    .where(eq(profiles.userId, userId));

  await db.delete(profileSkills).where(eq(profileSkills.userId, userId));
  if (skillIds.length > 0) {
    await db.insert(profileSkills).values(skillIds.map((skillId) => ({ userId, skillId })));
  }

  return { ok: true, profile: await getProfile(db, userId) };
}

export async function getSkillsForUsers(db: Db, userIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({ userId: profileSkills.userId, name: skills.name })
    .from(profileSkills)
    .innerJoin(skills, eq(profileSkills.skillId, skills.id))
    .where(inArray(profileSkills.userId, userIds));
  for (const row of rows) {
    const list = map.get(row.userId) ?? [];
    list.push(row.name);
    map.set(row.userId, list);
  }
  return map;
}
