import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { LightMyRequestResponse } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import { loadEnv } from "../src/env";
import { setupTestDb, uniqueEmail } from "./helpers";

let app: FastifyInstance;
let pool: pg.Pool;

const PASSWORD = "correct horse battery";

beforeAll(async () => {
  const { db, pool: p } = await setupTestDb();
  pool = p;
  app = await buildApp({ db, env: loadEnv() });
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

function cookieValue(res: LightMyRequestResponse, name: string): string | undefined {
  return res.cookies.find((c) => c.name === name)?.value;
}

async function signupUser(email: string, name = "Test User") {
  return app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email, password: PASSWORD, name },
  });
}

describe("auth (R1)", () => {
  it("signs up, returns 201 and a session cookie", async () => {
    const email = uniqueEmail();
    const res = await signupUser(email);
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.user.email).toBe(email);
    expect(body.user.passwordHash).toBeUndefined();
    expect(cookieValue(res, "cc_session")).toBeTruthy();
  });

  it("GET /me returns the user with a valid session cookie", async () => {
    const email = uniqueEmail();
    const res = await signupUser(email);
    const cookie = cookieValue(res, "cc_session")!;
    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { cc_session: cookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe(email);
    expect(me.json()).toHaveProperty("progress");
  });

  it("GET /me without a session returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/me" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a duplicate email signup with 400", async () => {
    const email = uniqueEmail();
    await signupUser(email);
    const res = await signupUser(email.toUpperCase());
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("email_taken");
  });

  it("logs in with valid credentials and rejects bad ones with 401", async () => {
    const email = uniqueEmail();
    await signupUser(email);

    const ok = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().user.email).toBe(email);

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: "wrong-password" },
    });
    expect(bad.statusCode).toBe(401);
  });

  it("returns 400, not 500, for malformed payloads", async () => {
    const badEmail = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: "not-an-email", password: PASSWORD, name: "X" },
    });
    expect(badEmail.statusCode).toBe(400);

    const shortPw = await app.inject({
      method: "POST",
      url: "/api/v1/auth/signup",
      payload: { email: uniqueEmail(), password: "short", name: "X" },
    });
    expect(shortPw.statusCode).toBe(400);

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
  });

  it("logout invalidates the session", async () => {
    const res = await signupUser(uniqueEmail());
    const cookie = cookieValue(res, "cc_session")!;

    const out = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      cookies: { cc_session: cookie },
    });
    expect(out.statusCode).toBe(200);

    const me = await app.inject({
      method: "GET",
      url: "/api/v1/me",
      cookies: { cc_session: cookie },
    });
    expect(me.statusCode).toBe(401);
  });
});
