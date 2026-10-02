import type { FastifyPluginAsync } from "fastify";
import { loginInputSchema, signupInputSchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { SESSION_COOKIE, makeRequireUser } from "../lib/require-user";
import { createSession, destroySession, login, publicUser, signup } from "../services/auth";

type Opts = { db: Db; sessionTtlDays: number };

export const authRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db, sessionTtlDays } = opts;
  const requireUser = makeRequireUser(db);

  const cookieOpts = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: false,
    maxAge: sessionTtlDays * 24 * 60 * 60,
  };

  app.post("/auth/signup", async (request, reply) => {
    const parsed = signupInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const result = await signup(db, parsed.data);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    const token = await createSession(db, result.user.id, sessionTtlDays);
    return reply.code(201).setCookie(SESSION_COOKIE, token, cookieOpts).send({ user: publicUser(result.user) });
  });

  app.post("/auth/login", async (request, reply) => {
    const parsed = loginInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const user = await login(db, parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const token = await createSession(db, user.id, sessionTtlDays);
    return reply.setCookie(SESSION_COOKIE, token, cookieOpts).send({ user: publicUser(user) });
  });

  app.post("/auth/logout", { preHandler: requireUser }, async (request, reply) => {
    if (request.sessionToken) await destroySession(db, request.sessionToken);
    return reply.clearCookie(SESSION_COOKIE, { path: "/" }).send({ ok: true });
  });

  app.get("/me", { preHandler: requireUser }, async (request, reply) => {
    return reply.send({ user: publicUser(request.user!), progress: 0 });
  });
};
