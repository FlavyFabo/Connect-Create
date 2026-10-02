import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { projectMembers } from "../src/db/schema";
import { computeProgress, type ScoreEvent } from "../src/services/progress";
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

async function makeProject(cookie: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    cookies: { cc_session: cookie },
    payload: { title: "P", description: "d", category: "c", skillsNeeded: ["x"] },
  });
  return res.json().id as string;
}

async function makeMilestone(cookie: string, projectId: string, done = true) {
  const res = await app.inject({
    method: "POST",
    url: `/api/v1/projects/${projectId}/milestones`,
    cookies: { cc_session: cookie },
    payload: { title: "M" },
  });
  const id = res.json().id as string;
  if (done) {
    await app.inject({
      method: "PATCH",
      url: `/api/v1/milestones/${id}`,
      cookies: { cc_session: cookie },
      payload: { state: "done", evidence: { type: "text", content: "proof" } },
    });
  }
  return id;
}

async function projectProgress(cookie: string, projectId: string) {
  const res = await app.inject({
    method: "GET",
    url: `/api/v1/projects/${projectId}`,
    cookies: { cc_session: cookie },
  });
  return res.json().progress;
}

describe("progress scoring (R8-R10)", () => {
  it("done+evidence scores 0.5; confirmed scores 1.0; done without evidence scores 0", async () => {
    const owner = await signup();
    const member = await signup();
    const projectId = await makeProject(owner.cookie);
    await db.insert(projectMembers).values({ projectId, userId: member.userId, role: "member" });

    const m1 = await makeMilestone(owner.cookie, projectId); // done w/ evidence
    const m2res = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/milestones`,
      cookies: { cc_session: owner.cookie },
      payload: { title: "no-ev" },
    });
    await app.inject({
      method: "PATCH",
      url: `/api/v1/milestones/${m2res.json().id}`,
      cookies: { cc_session: owner.cookie },
      payload: { state: "done" }, // no evidence -> weight 0
    });

    let progress = await projectProgress(owner.cookie, projectId);
    expect(progress.score).toBeCloseTo(0.5, 3);
    expect(progress.milestonesTotal).toBe(2);
    expect(progress.milestonesDone).toBe(2);

    await app.inject({
      method: "POST",
      url: `/api/v1/milestones/${m1}/confirm`,
      cookies: { cc_session: member.cookie },
    });
    progress = await projectProgress(owner.cookie, projectId);
    expect(progress.score).toBeCloseTo(1.0, 3);
    expect(progress.milestonesConfirmed).toBe(1);
  });

  it("credits the completer in their user score, not the confirmer", async () => {
    const owner = await signup();
    const member = await signup();
    const projectId = await makeProject(owner.cookie);
    await db.insert(projectMembers).values({ projectId, userId: member.userId, role: "member" });
    const m = await makeMilestone(owner.cookie, projectId);
    await app.inject({
      method: "POST",
      url: `/api/v1/milestones/${m}/confirm`,
      cookies: { cc_session: member.cookie },
    });

    const meOwner = await app.inject({ method: "GET", url: "/api/v1/me", cookies: { cc_session: owner.cookie } });
    const meMember = await app.inject({ method: "GET", url: "/api/v1/me", cookies: { cc_session: member.cookie } });
    expect(meOwner.json().progress).toBeCloseTo(1.0, 3);
    expect(meMember.json().progress).toBe(0);
  });

  it("voiding evidence drops the milestone weight", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);
    const m = await makeMilestone(owner.cookie, projectId);
    expect((await projectProgress(owner.cookie, projectId)).score).toBeCloseTo(0.5, 3);

    await app.inject({
      method: "PATCH",
      url: `/api/v1/milestones/${m}`,
      cookies: { cc_session: owner.cookie },
      payload: { evidence: null },
    });
    expect((await projectProgress(owner.cookie, projectId)).score).toBe(0);
  });
});

describe("computeProgress (pure)", () => {
  const base: ScoreEvent = {
    milestoneId: "m1",
    userId: "u1",
    projectId: "p1",
    type: "milestone_done",
    weight: 0.5,
    createdAt: new Date(),
  };

  it("decays weights by half every 30 days", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    const events: ScoreEvent[] = [
      { ...base, createdAt: new Date("2026-01-01T00:00:00Z") }, // 30 days -> 0.25
      { ...base, milestoneId: "m2", createdAt: new Date("2025-12-02T00:00:00Z") }, // 60 days -> 0.125
    ];
    const { projectScores } = computeProgress(events, now);
    expect(projectScores.get("p1")).toBeCloseTo(0.375, 3);
  });

  it("counts at most 5 milestones per project per day", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const events: ScoreEvent[] = Array.from({ length: 7 }, (_, i) => ({
      ...base,
      milestoneId: `m${i}`,
      createdAt: now, // same instant -> no decay; isolates the daily cap
    }));
    const { projectScores } = computeProgress(events, now);
    expect(projectScores.get("p1")).toBeCloseTo(2.5, 3);
  });

  it("uses the latest event per milestone", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    const events: ScoreEvent[] = [
      { ...base, createdAt: new Date("2026-01-01T00:00:00Z") },
      { ...base, type: "evidence_voided", weight: 0, createdAt: new Date("2026-01-01T01:00:00Z") },
    ];
    const { projectScores } = computeProgress(events, now);
    expect(projectScores.get("p1") ?? 0).toBe(0);
  });
});
