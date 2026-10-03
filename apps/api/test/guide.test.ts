import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { buildGuideContext, type GuideProvider, type GuideSuggestion } from "../src/services/guide";
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

async function makeProject(cookie: string, title = "P") {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    cookies: { cc_session: cookie },
    payload: { title, description: "d", category: "c", skillsNeeded: ["x"] },
  });
  return res.json().id as string;
}

function post(cookie: string, url: string) {
  return app.inject({ method: "POST", url, cookies: { cc_session: cookie } });
}

describe("AI guide (R19-R22)", () => {
  it("plan returns 3-7 suggestions and creates no milestones (R19, R22)", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie, "Solar oven");

    const res = await post(owner.cookie, `/api/v1/projects/${projectId}/guide/plan`);
    expect(res.statusCode).toBe(200);
    const suggestions = res.json().suggestions;
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    expect(suggestions.length).toBeLessThanOrEqual(7);
    for (const s of suggestions) {
      expect(s.title).toBeTruthy();
      expect(s.detail).toBeTruthy();
    }

    const wb = await app.inject({
      method: "GET",
      url: `/api/v1/projects/${projectId}/workbench`,
      cookies: { cc_session: owner.cookie },
    });
    expect(wb.json().milestones).toEqual([]);
  });

  it("nudge returns exactly one step of 30 minutes or less (R20)", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);

    const res = await post(owner.cookie, `/api/v1/projects/${projectId}/guide/nudge`);
    expect(res.statusCode).toBe(200);
    const suggestion = res.json().suggestion;
    expect(suggestion.title).toBeTruthy();
    expect(suggestion.estimateMinutes).toBeLessThanOrEqual(30);
  });

  it("guide context contains only the requesting project's data (R21)", async () => {
    const owner = await signup();
    const p1 = await makeProject(owner.cookie, "Secret project alpha");
    await makeProject(owner.cookie, "Unrelated beta project");

    const ctx = await buildGuideContext(db, p1);
    expect(ctx).toBeTruthy();
    const raw = JSON.stringify(ctx);
    expect(raw).toContain("Secret project alpha");
    expect(raw).not.toContain("Unrelated beta project");
    expect(raw).not.toMatch(/@example\.com/); // no user emails leak into prompts
  });

  it("non-members get 403; failures surface as 503 not 500", async () => {
    const owner = await signup();
    const outsider = await signup();
    const projectId = await makeProject(owner.cookie);

    expect((await post(outsider.cookie, `/api/v1/projects/${projectId}/guide/plan`)).statusCode).toBe(403);

    const failing: GuideProvider = {
      plan: async (): Promise<GuideSuggestion[]> => {
        throw new Error("provider down");
      },
      nudge: async (): Promise<GuideSuggestion> => {
        throw new Error("provider down");
      },
    };
    const degraded = await buildApp({ db, env: loadEnv(), guide: failing });
    const res = await degraded.inject({
      method: "POST",
      url: `/api/v1/projects/${projectId}/guide/plan`,
      cookies: { cc_session: owner.cookie },
    });
    expect(res.statusCode).toBe(503);
    await degraded.close();
  });
});
