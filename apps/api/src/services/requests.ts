import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { joinRequests, messages, projectMembers, projects } from "../db/schema";
import { isProjectMember } from "./project";

type RequestRow = typeof joinRequests.$inferSelect;

export type RequestView = {
  id: string;
  projectId: string;
  userId: string;
  kind: string;
  message: string;
  status: string;
  createdAt: string;
};

function toView(r: RequestRow): RequestView {
  return {
    id: r.id,
    projectId: r.projectId,
    userId: r.userId,
    kind: r.kind,
    message: r.message,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export type CreateRequestResult =
  | { ok: true; request: RequestView }
  | {
      ok: false;
      error: "not_found" | "forbidden" | "already_member" | "target_is_member" | "duplicate_pending" | "not_owner";
    };

export async function createRequest(
  db: Db,
  projectId: string,
  senderId: string,
  input: { message: string; userId?: string | undefined },
): Promise<CreateRequestResult> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return { ok: false, error: "not_found" };

  const isOwner = project.ownerId === senderId;

  if (input.userId) {
    if (!isOwner) return { ok: false, error: "not_owner" };
    if (await isProjectMember(db, projectId, input.userId)) return { ok: false, error: "target_is_member" };
    const [dup] = await db
      .select({ id: joinRequests.id })
      .from(joinRequests)
      .where(
        and(
          eq(joinRequests.projectId, projectId),
          eq(joinRequests.userId, input.userId),
          eq(joinRequests.status, "pending"),
        ),
      )
      .limit(1);
    if (dup) return { ok: false, error: "duplicate_pending" };
    const [row] = await db
      .insert(joinRequests)
      .values({ projectId, userId: input.userId, kind: "invite", message: input.message })
      .returning();
    return { ok: true, request: toView(row!) };
  }

  if (await isProjectMember(db, projectId, senderId)) return { ok: false, error: "already_member" };
  const [dup] = await db
    .select({ id: joinRequests.id })
    .from(joinRequests)
    .where(
      and(
        eq(joinRequests.projectId, projectId),
        eq(joinRequests.userId, senderId),
        eq(joinRequests.status, "pending"),
      ),
    )
    .limit(1);
  if (dup) return { ok: false, error: "duplicate_pending" };
  const [row] = await db
    .insert(joinRequests)
    .values({ projectId, userId: senderId, kind: "join_request", message: input.message })
    .returning();
  return { ok: true, request: toView(row!) };
}

export async function getRequestById(db: Db, id: string): Promise<RequestRow | null> {
  const [row] = await db.select().from(joinRequests).where(eq(joinRequests.id, id)).limit(1);
  return row ?? null;
}

async function canResolve(db: Db, request: RequestRow, actorId: string): Promise<boolean> {
  if (request.kind === "invite") return request.userId === actorId;
  const [project] = await db.select().from(projects).where(eq(projects.id, request.projectId)).limit(1);
  return project?.ownerId === actorId;
}

export type ResolveResult =
  | { ok: true; request: RequestView }
  | { ok: false; error: "not_pending" | "forbidden" };

async function resolve(
  db: Db,
  request: RequestRow,
  actorId: string,
  status: "accepted" | "declined",
): Promise<ResolveResult> {
  if (request.status !== "pending") return { ok: false, error: "not_pending" };
  if (!(await canResolve(db, request, actorId))) return { ok: false, error: "forbidden" };

  const [row] = await db
    .update(joinRequests)
    .set({ status, resolvedAt: new Date() })
    .where(eq(joinRequests.id, request.id))
    .returning();

  if (status === "accepted") {
    await db
      .insert(projectMembers)
      .values({ projectId: request.projectId, userId: request.userId, role: "member" })
      .onConflictDoNothing();
    await db.update(projects).set({ lastActivityAt: new Date() }).where(eq(projects.id, request.projectId));
  }
  return { ok: true, request: toView(row!) };
}

export const acceptRequest = (db: Db, r: RequestRow, actorId: string) => resolve(db, r, actorId, "accepted");
export const declineRequest = (db: Db, r: RequestRow, actorId: string) => resolve(db, r, actorId, "declined");

export async function listProjectRequests(db: Db, projectId: string): Promise<RequestView[]> {
  const rows = await db
    .select()
    .from(joinRequests)
    .where(eq(joinRequests.projectId, projectId))
    .orderBy(desc(joinRequests.createdAt));
  return rows.map(toView);
}

export type MessageView = {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
};

export async function addMessage(db: Db, projectId: string, authorId: string, body: string): Promise<MessageView> {
  const [row] = await db.insert(messages).values({ projectId, authorId, body }).returning();
  await db.update(projects).set({ lastActivityAt: new Date() }).where(eq(projects.id, projectId));
  return { id: row!.id, authorId: row!.authorId, body: row!.body, createdAt: row!.createdAt.toISOString() };
}

export async function listMessages(db: Db, projectId: string): Promise<MessageView[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.projectId, projectId))
    .orderBy(asc(messages.createdAt))
    .limit(200);
  return rows.map((r) => ({ id: r.id, authorId: r.authorId, body: r.body, createdAt: r.createdAt.toISOString() }));
}
