import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { buildApp } from "../src/app";
import type { Db } from "../src/db/client";
import { projectMembers } from "../src/db/schema";
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

async function signup(email?: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/signup",
    payload: { email: email ?? uniqueEmail(), password: "correct horse battery", name: "T" },
  });
  return {
    cookie: res.cookies.find((c) => c.name === "cc_session")!.value,
    userId: res.json().user.id as string,
  };
}

async function makeProject(cookie: string) {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/projects",
    cookies: { cc_session: cookie },
    payload: {
      title: "P",
      description: "d",
      category: "c",
      skillsNeeded: ["x"],
    },
  });
  return res.json().id as string;
}

async function addMember(projectId: string, userId: string) {
  await db.insert(projectMembers).values({ projectId, userId, role: "member" });
}

function req(cookie: string, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) {
  return app.inject({ method, url, cookies: { cc_session: cookie }, payload });
}

describe("workbench (R5-R7, R17)", () => {
  it("denies non-members read access with 403", async () => {
    const owner = await signup();
    const outsider = await signup();
    const projectId = await makeProject(owner.cookie);

    const res = await req(outsider.cookie, "GET", `/api/v1/projects/${projectId}/workbench`);
    expect(res.statusCode).toBe(403);

    const okRes = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`);
    expect(okRes.statusCode).toBe(200);
    expect(okRes.json().milestones).toEqual([]);
  });

  it("returns 404 for unknown project workbench", async () => {
    const u = await signup();
    const res = await req(u.cookie, "GET", "/api/v1/projects/00000000-0000-0000-0000-000000000000/workbench");
    expect(res.statusCode).toBe(404);
  });

  it("creates and lists milestones (CRUD)", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);

    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "Sketch UI" });
    expect(create.statusCode).toBe(201);
    const milestoneId = create.json().id;

    await req(owner.cookie, "PATCH", `/api/v1/milestones/${milestoneId}`, { title: "Sketch UI v2" });
    const wb = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`);
    expect(wb.json().milestones[0].title).toBe("Sketch UI v2");
    expect(wb.json().milestones[0].state).toBe("todo");

    const del = await req(owner.cookie, "DELETE", `/api/v1/milestones/${milestoneId}`);
    expect(del.statusCode).toBe(200);
    const wb2 = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`);
    expect(wb2.json().milestones).toEqual([]);
  });

  it("marks done with evidence (R6)", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);
    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const milestoneId = create.json().id;

    const res = await req(owner.cookie, "PATCH", `/api/v1/milestones/${milestoneId}`, {
      state: "done",
      evidence: { type: "url", content: "https://example.com/demo" },
    });
    expect(res.statusCode).toBe(200);
    const m = res.json().milestone;
    expect(m.state).toBe("done");
    expect(m.evidence.content).toBe("https://example.com/demo");
    expect(m.completedBy).toBe(owner.userId);
  });

  it("marks done without evidence", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);
    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const res = await req(owner.cookie, "PATCH", `/api/v1/milestones/${create.json().id}`, { state: "done" });
    expect(res.statusCode).toBe(200);
    expect(res.json().milestone.evidence).toBeNull();
  });

  it("forbids self-confirmation with 403 (progress rule)", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);
    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const milestoneId = create.json().id;
    await req(owner.cookie, "PATCH", `/api/v1/milestones/${milestoneId}`, { state: "done" });

    const res = await req(owner.cookie, "POST", `/api/v1/milestones/${milestoneId}/confirm`);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("self_confirm");
  });

  it("lets another member confirm a done milestone (R7)", async () => {
    const owner = await signup();
    const member = await signup();
    const projectId = await makeProject(owner.cookie);
    await addMember(projectId, member.userId);

    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const milestoneId = create.json().id;
    await req(owner.cookie, "PATCH", `/api/v1/milestones/${milestoneId}`, { state: "done" });

    const res = await req(member.cookie, "POST", `/api/v1/milestones/${milestoneId}/confirm`);
    expect(res.statusCode).toBe(200);
    const m = res.json().milestone;
    expect(m.state).toBe("confirmed");
    expect(m.confirmedBy).toBe(member.userId);
  });

  it("rejects confirming a todo milestone with 400", async () => {
    const owner = await signup();
    const member = await signup();
    const projectId = await makeProject(owner.cookie);
    await addMember(projectId, member.userId);

    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const res = await req(member.cookie, "POST", `/api/v1/milestones/${create.json().id}/confirm`);
    expect(res.statusCode).toBe(400);
  });

  it("denies non-members milestone writes with 403", async () => {
    const owner = await signup();
    const outsider = await signup();
    const projectId = await makeProject(owner.cookie);
    const create = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/milestones`, { title: "M" });
    const milestoneId = create.json().id;

    expect((await req(outsider.cookie, "PATCH", `/api/v1/milestones/${milestoneId}`, { state: "done" })).statusCode).toBe(403);
    expect((await req(outsider.cookie, "POST", `/api/v1/milestones/${milestoneId}/confirm`)).statusCode).toBe(403);
  });

  it("stores workbench notes", async () => {
    const owner = await signup();
    const projectId = await makeProject(owner.cookie);
    const res = await req(owner.cookie, "POST", `/api/v1/projects/${projectId}/notes`, { body: "first note" });
    expect(res.statusCode).toBe(201);

    const wb = await req(owner.cookie, "GET", `/api/v1/projects/${projectId}/workbench`);
    expect(wb.json().notes[0].body).toBe("first note");
  });
});
