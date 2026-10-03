import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import type { Db } from "./db/client";
import type { Env } from "./env";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { projectRoutes } from "./routes/projects";
import { workbenchRoutes } from "./routes/workbench";
import { requestRoutes } from "./routes/requests";
import { guideRoutes } from "./routes/guide";
import { reportRoutes } from "./routes/reports";
import { RuleBasedGuide, type GuideProvider } from "./services/guide";
import { defaultRateLimits, RateLimiter } from "./lib/rate-limit";

export async function buildApp(deps: {
  db: Db;
  env: Env;
  guide?: GuideProvider;
  rateLimiter?: RateLimiter;
}): Promise<FastifyInstance> {
  const { db, env } = deps;
  const guide = deps.guide ?? new RuleBasedGuide();
  const rateLimiter = deps.rateLimiter ?? new RateLimiter(defaultRateLimits);
  const app = Fastify({ logger: { level: "warn" } });

  await app.register(cookie);
  await app.register(authRoutes, {
    prefix: "/api/v1",
    db,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    rateLimiter,
  });
  await app.register(meRoutes, { prefix: "/api/v1", db });
  await app.register(projectRoutes, { prefix: "/api/v1", db });
  await app.register(workbenchRoutes, { prefix: "/api/v1", db });
  await app.register(requestRoutes, { prefix: "/api/v1", db, rateLimiter });
  await app.register(guideRoutes, { prefix: "/api/v1", db, guide, rateLimiter });
  await app.register(reportRoutes, { prefix: "/api/v1", db });

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    return reply.code(500).send({ error: "internal_error" });
  });

  return app;
}
