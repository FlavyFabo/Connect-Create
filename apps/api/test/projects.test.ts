import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { setupTestDb, uniqueEmail } from "./helpers";

let app: FastifyInstance;
let pool: pg.Pool;

beforeAll(async () => {
  const { db, pool: p } = await setupTestDb();
  pool = p;
  app = await buildApp({ db, env: loadEnv() });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

async function signupCookie() {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email: uniqueEmail(), password: "correct horse battery", name: "T" },
  });
  return res.cookies.find((c) => c.name === "cc_session")!.value;
}

function createProject(cookie: string, payload: Record<string, unknown>) {
  return app.inject({ method: "POST", url: "/api/v1/projects", cookies: { cc_session: cookie }, payload });
}

const VALID = {
  title: "Synth tracker",
  description: "Build a web-based synth sequencer",
  category: "music-tech",
};

describe("projects (R4)", () => {
  it("creates a project and returns its id", async () => {
    const cookie = await signupCookie();
    const res = await createProject(cookie, { ...VALID, skillsNeeded: ["TypeScript", "Audio"] });
    expect(res.statusCode).toBe(201);
    const { id } = res.json();
    expect(id).toBeTruthy();

    const get = await app.inject({ method: "GET", url: `/api/v1/projects/${id}`, cookies: { cc_session: cookie } });
    expect(get.statusCode).toBe(200);
    const { project } = get.json();
    expect(project.title).toBe(VALID.title);
    expect(project.status).toBe("open");
    expect(project.skillsNeeded).toEqual(["typescript", "audio"]);
  });

  it("rejects invalid input with 400, not 500", async () => {
    const cookie = await signupCookie();
    for (const payload of [
      { ...VALID, skillsNeeded: [] },
      { ...VALID, skillsNeeded: Array.from({ length: 11 }, (_, i) => `s${i}`) },
      { ...VALID, skillsNeeded: ["Go", " go "] },
      { title: "", description: "x", category: "c", skillsNeeded: ["x"] },
      { ...VALID, skillsNeeded: "not-an-array" },
    ]) {
      const res = await createProject(cookie, payload as Record<string, unknown>);
      expect(res.statusCode).toBe(400);
    }
  });

  it("requires auth", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/projects", payload: { ...VALID, skillsNeeded: ["x"] } });
    expect(res.statusCode).toBe(401);
  });
});

describe("discovery list (R11 basic)", () => {
  it("filters by skills and category", async () => {
    const cookie = await signupCookie();
    await createProject(cookie, { ...VALID, title: "A", skillsNeeded: ["react"] });
    await createProject(cookie, { ...VALID, title: "B", category: "games", skillsNeeded: ["unity"] });
    await createProject(cookie, { ...VALID, title: "C", skillsNeeded: ["react", "node"] });

    const all = await app.inject({ method: "GET", url: "/api/v1/projects", cookies: { cc_session: cookie } });
    expect(all.statusCode).toBe(200);
    expect(all.json().items.length).toBeGreaterThanOrEqual(3);

    const react = await app.inject({
      method: "GET",
      url: "/api/v1/projects?skills=react",
      cookies: { cc_session: cookie },
    });
    const titles = react.json().items.map((i: { title: string }) => i.title);
    expect(titles).toContain("A");
    expect(titles).toContain("C");
    expect(titles).not.toContain("B");

    const games = await app.inject({
      method: "GET",
      url: "/api/v1/projects?category=games",
      cookies: { cc_session: cookie },
    });
    expect(games.json().items.map((i: { title: string }) => i.title)).toEqual(["B"]);
  });

  it("returns 404 for an unknown project", async () => {
    const cookie = await signupCookie();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/projects/00000000-0000-0000-0000-000000000000",
      cookies: { cc_session: cookie },
    });
    expect(res.statusCode).toBe(404);
  });
});
