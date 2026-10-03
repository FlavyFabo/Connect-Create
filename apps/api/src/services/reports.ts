import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { messages, projects, reports, users } from "../db/schema";

export type ReportTarget = "project" | "user" | "message";

export async function targetExists(db: Db, targetType: ReportTarget, targetId: string): Promise<boolean> {
  if (targetType === "project") {
    const [row] = await db.select({ id: projects.id }).from(projects).where(eq(projects.id, targetId)).limit(1);
    return !!row;
  }
  if (targetType === "user") {
    const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, targetId)).limit(1);
    return !!row;
  }
  const [row] = await db.select({ id: messages.id }).from(messages).where(eq(messages.id, targetId)).limit(1);
  return !!row;
}

export async function createReport(
  db: Db,
  reporterId: string,
  input: { targetType: ReportTarget; targetId: string; reason: string },
): Promise<{ id: string } | null> {
  if (!(await targetExists(db, input.targetType, input.targetId))) return null;
  const [row] = await db
    .insert(reports)
    .values({ reporterId, targetType: input.targetType, targetId: input.targetId, reason: input.reason })
    .returning({ id: reports.id });
  return row ? { id: row.id } : null;
}
