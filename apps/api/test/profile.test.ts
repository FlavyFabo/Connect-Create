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

function putProfile(cookie: string, payload: unknown) {
  return app.inject({
    method: "PUT",
    url: "/api/v1/me/profile",
    cookies: { cc_session: cookie },
    payload: payload as Record<string, unknown>,
  });
}

describe("profiles (R2)", () => {
  it("stores skills, interests, and availability", async () => {
    const cookie = await signupCookie();
    const res = await putProfile(cookie, {
      skills: ["TypeScript", "React"],
      interests: ["synths"],
      availability: ["weekday-evening"],
    });
    expect(res.statusCode).toBe(200);
    const { profile } = res.json();
    expect(profile.skills).toEqual(["typescript", "react"]);
    expect(profile.interests).toEqual(["synths"]);
    expect(profile.availability).toEqual(["weekday-evening"]);
  });

  it("GET /me returns the saved profile", async () => {
    const cookie = await signupCookie();
    await putProfile(cookie, { skills: ["rust"], interests: [], availability: [] });
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { cc_session: cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().profile.skills).toEqual(["rust"]);
  });

  it("replaces skills on update", async () => {
    const cookie = await signupCookie();
    await putProfile(cookie, { skills: ["go", "k8s"], interests: [], availability: [] });
    const res = await putProfile(cookie, { skills: ["python"], interests: [], availability: [] });
    expect(res.json().profile.skills).toEqual(["python"]);
  });

  it("rejects empty skills with 400, not 500", async () => {
    const cookie = await signupCookie();
    const res = await putProfile(cookie, { skills: [], interests: [], availability: [] });
    expect(res.statusCode).toBe(400);
  });

  it("rejects more than 20 skills with 400", async () => {
    const cookie = await signupCookie();
    const skills = Array.from({ length: 21 }, (_, i) => `skill-${i}`);
    const res = await putProfile(cookie, { skills, interests: [], availability: [] });
    expect(res.statusCode).toBe(400);
  });

  it("rejects duplicate skills (after normalization) with 400", async () => {
    const cookie = await signupCookie();
    const res = await putProfile(cookie, {
      skills: ["React", " react "],
      interests: [],
      availability: [],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("duplicate_skills");
  });

  it("rejects unauthenticated profile updates with 401", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/me/profile",
      payload: { skills: ["go"], interests: [], availability: [] },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("no popularity signals (R3)", () => {
  it("exposes no follower/like counts in any response", async () => {
    const cookie = await signupCookie();
    for (const res of [
      await app.inject({ method: "GET", url: "/api/v1/me", cookies: { cc_session: cookie } }),
      await putProfile(cookie, { skills: ["go"], interests: [], availability: [] }),
    ]) {
      const raw = JSON.stringify(res.json()).toLowerCase();
      expect(raw).not.toContain("follower");
      expect(raw).not.toContain("\"likes\"");
    }
  });
});
