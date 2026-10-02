import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { joinRequests, projectMembers, projects } from "../src/db/schema";
import { loadEnv } from "../src/env";
import { setupTestDb, uniqueEmail } from "./helpers";

let app: FastifyInstance;
let pool: pg.Pool;
let db: Db;

beforeAll(async () => {
  const setup = await setupTestDb();
  db = setup.db;
  pool = setup.pool;
  app = await buildApp({ db, env: loadEnv() });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function signup() {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email: uniqueEmail(), password: "correct horse battery", name: "T" },
  });
  return { cookie: res.cookies.find((c) => c.name === "cc_session")!.value, userId: res.json().user.id as string };
}

async function setProfile(cookie: string, skills: string[]) {
  return app.inject({
    method: "PUT",
    url: "/api/v1/me/profile",
    cookies: { cc_session: cookie },
    payload: { skills, interests: [], availability: [] },
  });
}

async function makeProject(cookie: string, skillsNeeded: string[], title = "P") {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    cookies: { cc_session: cookie },
    payload: { title, description: "d", category: "c", skillsNeeded },
  });
  return res.json().id as string;
}

function ageProject(projectId: string, days: number) {
  const d = new Date(Date.now() - days * 86_400_000);
  return db.update(projects).set({ createdAt: d }).where(eq(projects.id, projectId));
}

function get(cookie: string, url: string) {
  return app.inject({ method: "GET", url, cookies: { cc_session: cookie } });
}

describe("match ranking (R11-R14)", () => {
  it("a new user's project appears for users with overlapping skills (R11)", async () => {
    const owner = await signup();
    const viewer = await signup();
    await setProfile(viewer.cookie, ["react"]);
    const projectId = await makeProject(owner.cookie, ["react", "css"], "Overlap Project");

    const res = await get(viewer.cookie, "/api/v1/projects?sort=match");
    expect(res.statusCode).toBe(200);
    const item = res.json().items.find((i: { project: { id: string } }) => i.project.id === projectId);
    expect(item).toBeTruthy();
    expect(item.reasons.sharedSkills).toEqual(["react"]);
    expect(item.matchScore).toBeGreaterThan(0);
  });

  it("ranks higher skill fit first", async () => {
    const owner = await signup();
    const viewer = await signup();
    await setProfile(viewer.cookie, ["react", "node", "ts"]);
    const low = await makeProject(owner.cookie, ["unity"], "Low");
    const high = await makeProject(owner.cookie, ["react", "node"], "High");

    const res = await get(viewer.cookie, "/api/v1/projects?sort=match");
    const items = res.json().items;
    const idxHigh = items.findIndex((i: { project: { id: string } }) => i.project.id === high);
    const idxLow = items.findIndex((i: { project: { id: string } }) => i.project.id === low);
    expect(idxHigh).toBeGreaterThanOrEqual(0);
    expect(idxLow).toBeGreaterThanOrEqual(0);
    expect(idxHigh).toBeLessThan(idxLow);
  });

  it("equal skill fit: the project with more recent confirmed progress ranks higher (R11, R13)", async () => {
    const owner = await signup();
    const confirmer = await signup();
    const viewer = await signup();
    await setProfile(viewer.cookie, ["go"]);

    const stale = await makeProject(owner.cookie, ["go"], "Stale");
    const active = await makeProject(owner.cookie, ["go"], "Active");
    // Both older than the 14-day neutral baseline so raw progress decides.
    await ageProject(stale, 20);
    await ageProject(active, 20);

    await db.insert(projectMembers).values({ projectId: active, userId: confirmer.userId, role: "member" });
    const m = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${active}/milestones`,
      cookies: { cc_session: owner.cookie },
      payload: { title: "M" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/milestones/${m.json().id}`,
      cookies: { cc_session: owner.cookie },
      payload: { state: "done", evidence: { type: "text", content: "proof" } },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/milestones/${m.json().id}/confirm`,
      cookies: { cc_session: confirmer.cookie },
    });

    const res = await get(viewer.cookie, "/api/v1/projects?sort=match");
    const items = res.json().items;
    const idxActive = items.findIndex((i: { project: { id: string } }) => i.project.id === active);
    const idxStale = items.findIndex((i: { project: { id: string } }) => i.project.id === stale);
    expect(idxActive).toBeGreaterThanOrEqual(0);
    expect(idxStale).toBeGreaterThanOrEqual(0);
    expect(idxActive).toBeLessThan(idxStale);
  });

  it("excludes projects the viewer already belongs to", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie, ["x"], "Mine");
    const res = await get(owner.cookie, "/api/v1/projects?sort=match");
    expect(res.json().items.find((i: { project: { id: string } }) => i.project.id === projectId)).toBeUndefined();
  });
});

describe("candidates (R12)", () => {
  it("owner sees users ranked by skill fit; non-owner gets 403", async () => {
    const owner = await signup();
    const skilled = await signup();
    const unskilled = await signup();
    await setProfile(skilled.cookie, ["react", "node"]);
    await setProfile(unskilled.cookie, ["unity"]);
    const projectId = await makeProject(owner.cookie, ["react", "node"], "P");

    const res = await get(owner.cookie, `/api/v1/projects/${projectId}/candidates`);
    expect(res.statusCode).toBe(200);
    const items = res.json().items;
    expect(items[0].user.id).toBe(skilled.userId);
    expect(items[0].reasons.sharedSkills).toEqual(["react", "node"]);

    const forbidden = await get(skilled.cookie, `/api/v1/projects/${projectId}/candidates`);
    expect(forbidden.statusCode).toBe(403);
  });
});

describe("needs a first collaborator (R15)", () => {
  it("lists projects idle 7+ days with no requests only", async () => {
    const owner = await signup();
    const viewer = await signup();

    const idle = await makeProject(owner.cookie, ["x"], "Idle");
    await ageProject(idle, 8);

    const fresh = await makeProject(owner.cookie, ["x"], "Fresh");

    const answered = await makeProject(owner.cookie, ["x"], "Answered");
    await ageProject(answered, 8);
    await db.insert(joinRequests).values({
      projectId: answered,
      userId: viewer.userId,
      kind: "join_request",
      message: "hi",
    });

    const res = await get(viewer.cookie, "/api/v1/projects/needs-first-collaborator");
    expect(res.statusCode).toBe(200);
    const ids = res.json().items.map((i: { id: string }) => i.id);
    expect(ids).toContain(idle);
    expect(ids).not.toContain(fresh);
    expect(ids).not.toContain(answered);
  });
});
