import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";

export async function buildApp(deps: { db: Db; env: Env }): Promise<FastifyInstance> {
  const { db, env } = deps;
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(cookie);
  await app.register(authRoutes, {
    prefix: "/api/v1",
    db,
    sessionTtlDays: env.SESSION_TTL_DAYS,
  });

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  return app;
}
