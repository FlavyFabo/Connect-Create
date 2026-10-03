import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { loadEnv } from "../src/env";
import { setupTestDb, uniqueEmail } from "./helpers";

let app: FastifyInstance;
let pool: pg.Pool;
let db: Db;
void db;

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

function req(cookie: string, method: "GET" | "POST", url: string, payload?: object) {
  return app.inject({ method, url, cookies: { cc_session: cookie }, payload });
}

describe("join requests and invites (R16-R17)", () => {
  it("user sends a join request; owner accepts; requester gains workbench access", async () => {
    const owner = await signup();
    const joiner = await signup();
    const projectId = await makeProject(owner.cookie);

    expect((await req(joiner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`)).statusCode).toBe(403);

    const created = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "let me help" });
    expect(created.statusCode).toBe(201);
    const requestId = created.json().id;

    const list = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/requests`);
    expect(list.json().items[0].id).toBe(requestId);

    const accept = await req(owner.cookie, "POST", `/api/v1/requests/${requestId}/accept`);
    expect(accept.statusCode).toBe(200);
    expect(accept.json().request.status).toBe("accepted");

    expect((await req(joiner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`)).statusCode).toBe(200);
  });

  it("declined requests grant no access", async () => {
    const owner = await signup();
    const joiner = await signup();
    const projectId = await makeProject(owner.cookie);
    const created = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "pls" });
    const requestId = created.json().id;

    const decline = await req(owner.cookie, "POST", `/api/v1/requests/${requestId}/decline`);
    expect(decline.statusCode).toBe(200);
    expect((await req(joiner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`)).statusCode).toBe(403);
  });

  it("owner invites a user; invitee accepts and becomes a member", async () => {
    const owner = await signup();
    const invitee = await signup();
    const projectId = await makeProject(owner.cookie);

    const created = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, {
      message: "join us",
      userId: invitee.userId,
    });
    expect(created.statusCode).toBe(201);
    const requestId = created.json().id;

    const accept = await req(invitee.cookie, "POST", `/api/v1/requests/${requestId}/accept`);
    expect(accept.statusCode).toBe(200);
    expect((await req(invitee.cookie, "GET", `/api/v1/projects/${projectId}/workbench`)).statusCode).toBe(200);
  });

  it("non-owner cannot invite or resolve; requester cannot self-accept", async () => {
    const owner = await signup();
    const joiner = await signup();
    const third = await signup();
    const projectId = await makeProject(owner.cookie);

    const notOwner = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, {
      message: "x",
      userId: third.userId,
    });
    expect(notOwner.statusCode).toBe(403);

    const created = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "hi" });
    const requestId = created.json().id;
    expect((await req(joiner.cookie, "POST", `/api/v1/requests/${requestId}/accept`)).statusCode).toBe(403);
    expect((await req(third.cookie, "POST", `/api/v1/requests/${requestId}/accept`)).statusCode).toBe(403);
  });

  it("rejects >500 char messages and duplicate pending requests with 400", async () => {
    const owner = await signup();
    const joiner = await signup();
    const projectId = await makeProject(owner.cookie);

    const tooLong = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, {
      message: "x".repeat(501),
    });
    expect(tooLong.statusCode).toBe(400);

    await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "hi" });
    const dup = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "again" });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().error).toBe("duplicate_pending");
  });
});

describe("project messages (R18)", () => {
  it("members post and read messages; non-members get 403", async () => {
    const owner = await signup();
    const joiner = await signup();
    const outsider = await signup();
    const projectId = await makeProject(owner.cookie);

    const created = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/requests`, { message: "hi" });
    await req(owner.cookie, "POST", `/api/v1/requests/${created.json().id}/accept`);

    const post = await req(joiner.cookie, "POST", `/api/v1/projects/${projectId}/messages`, { body: "hello team" });
    expect(post.statusCode).toBe(201);

    const list = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/messages`);
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].body).toBe("hello team");

    expect((await req(outsider.cookie, "GET", `/api/v1/projects/${projectId}/messages`)).statusCode).toBe(403);
    expect((await req(outsider.cookie, "POST", `/api/v1/projects/${projectId}/messages`, { body: "x" })).statusCode).toBe(403);
  });
});
