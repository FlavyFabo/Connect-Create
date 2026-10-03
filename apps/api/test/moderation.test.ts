import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { RateLimiter } from "../src/lib/rate-limit";
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

async function signup(instance: FastifyInstance = app) {
  const res = await instance.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email: uniqueEmail(), password: "correct horse battery", name: "T" },
  });
  return { cookie: res.cookies.find((c) => c.name === "cc_session")!.value, userId: res.json().user.id as string };
}

async function makeProject(cookie: string, instance: FastifyInstance = app) {
  const res = await instance.inject({
    method: "POST",
    url: "/api/v1/projects",
    cookies: { cc_session: cookie },
    payload: { title: "P", description: "d", category: "c", skillsNeeded: ["x"] },
  });
  return res.json().id as string;
}

function req(instance: FastifyInstance, cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return instance.inject({ method, url, cookies: { cc_session: cookie }, payload });
}

describe("reports (R23)", () => {
  it("reports a project, a user, and a message", async () => {
    const owner = await signup();
    const reporter = await signup();
    const projectId = await makeProject(owner.cookie);

    for (const target of [
      { targetType: "project", targetId: projectId },
      { targetType: "user", targetId: owner.userId },
    ]) {
      const res = await req(app, reporter.cookie, "POST", "/api/v1/reports", { ...target, reason: "spam" });
      expect(res.statusCode).toBe(201);
      expect(res.json().id).toBeTruthy();
    }

    const joiner = await signup();
    const created = await req(app, joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "hi" });
    await req(app, owner.cookie, "POST", `/api/v1/requests/${created.json().id}/accept`);
    const msg = await req(app, joiner.cookie, "POST", `/api/v1/projects/${projectId}/messages`, { body: "bad message" });
    const messageId = msg.json().id;

    const msgReport = await req(app, reporter.cookie, "POST", "/api/v1/reports", {
      targetType: "message",
      targetId: messageId,
      reason: "harassment",
    });
    expect(msgReport.statusCode).toBe(201);
  });

  it("returns 404 for missing targets and 400 for bad input", async () => {
    const reporter = await signup();
    const missing = await req(app, reporter.cookie, "POST", "/api/v1/reports", {
      targetType: "project",
      targetId: "00000000-0000-0000-0000-000000000000",
      reason: "x",
    });
    expect(missing.statusCode).toBe(404);

    const bad = await req(app, reporter.cookie, "POST", "/api/v1/reports", {
      targetType: "project",
      targetId: "not-a-uuid",
      reason: "",
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe("rate limits (R24)", () => {
  it("the 21st join request in a day returns 429", async () => {
    const owner = await signup();
    const joiner = await signup();
    const projectIds: string[] = [];
    for (let i = 0; i < 21; i++) {
      projectIds.push(await makeProject(owner.cookie));
    }
    for (let i = 0; i < 20; i++) {
      const res = await req(app, joiner.cookie, "POST", `/api/v1/projects/${projectIds[i]}/requests`, {
        message: `request ${i}`,
      });
      expect(res.statusCode).toBe(201);
    }
    const res = await req(app, joiner.cookie, "POST", `/api/v1/projects/${projectIds[20]}/requests`, {
      message: "one too many",
    });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toBe("rate_limited");
  });

  it("limits messages, guide calls, and signups", async () => {
    const limited = await buildApp({
      db,
      env: loadEnv(),
      rateLimiter: new RateLimiter({ signup: 1, join_request: 20, message: 1, guide: 1 }),
    });
    try {
      const owner = await signup(limited); // consumes the single signup allowance for this IP
      const second = await limited.inject({
        method: "POST",
        url: "/api/v1/auth/signup",
        payload: { email: uniqueEmail(), password: "correct horse battery", name: "T" },
      });
      expect(second.statusCode).toBe(429);

      const projectId = await makeProject(owner.cookie, limited);
      const m1 = await req(limited, owner.cookie, "POST", `/api/v1/projects/${projectId}/messages`, { body: "one" });
      expect(m1.statusCode).toBe(201);
      const m2 = await req(limited, owner.cookie, "POST", `/api/v1/projects/${projectId}/messages`, { body: "two" });
      expect(m2.statusCode).toBe(429);

      const g1 = await req(limited, owner.cookie, "POST", `/api/v1/projects/${projectId}/guide/plan`);
      expect(g1.statusCode).toBe(200);
      const g2 = await req(limited, owner.cookie, "POST", `/api/v1/projects/${projectId}/guide/nudge`);
      expect(g2.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
