import { eq } from "drizzle-orm";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/client";
import { profiles, sessions, users } from "../db/schema";
import type { SignupInput } from "@connect-create/shared";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const actual = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expectedBuf = Buffer.from(expected, "hex");
  return actual.length === expectedBuf.length && timingSafeEqual(actual, expectedBuf);
}

export type UserRow = typeof users.$inferSelect;

export function publicUser(u: UserRow) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    createdAt: u.createdAt.toISOString(),
  };
}

export type SignupResult =
  | { ok: true; user: UserRow }
  | { ok: false; error: "email_taken" };

export async function signup(db: Db, input: SignupInput): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return { ok: false, error: "email_taken" };

  const [user] = await db
    .insert(users)
    .values({ email, passwordHash: hashPassword(input.password), name: input.name })
    .returning();
  if (!user) throw new Error("insert failed");
  await db.insert(profiles).values({ userId: user.id });
  return { ok: true, user };
}

export async function login(db: Db, email: string, password: string): Promise<UserRow | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);
  if (!user) return null;
  return verifyPassword(password, user.passwordHash) ? user : null;
}

export async function createSession(db: Db, userId: string, ttlDays: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ id: token, userId, expiresAt });
  return token;
}

export async function getSessionUser(db: Db, token: string): Promise<UserRow | null> {
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt.getTime() <= Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, token));
    return null;
  }
  return row.user;
}

export async function destroySession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, token));
}
