import type { FastifyPluginAsync } from "fastify";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { isProjectMember } from "../services/project";
import { buildGuideContext, type GuideProvider } from "../services/guide";

import type { RateLimiter } from "../lib/rate-limit";

type Opts = { db: Db; guide: GuideProvider; rateLimiter: RateLimiter };

export const guideRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db, guide, rateLimiter } = opts;
  const requireUser = makeRequireUser(db);

  async function loadContext(request: { params: unknown; user?: { id: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    const { id } = request.params as { id: string };
    const ctx = await buildGuideContext(db, id);
    if (!ctx) {
      await reply.code(404).send({ error: "not_found" });
      return null;
    }
    if (!(await isProjectMember(db, id, request.user!.id))) {
      await reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return ctx;
  }

  app.post("/projects/:id/guide/plan", { preHandler: requireUser }, async (request, reply) => {
    const ctx = await loadContext(request, reply);
    if (!ctx) return;
    if (!rateLimiter.consume("guide", request.user!.id)) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    try {
      const suggestions = await guide.plan(ctx);
      return reply.send({ suggestions });
    } catch {
      return reply.code(503).send({ error: "guide_unavailable" });
    }
  });

  app.post("/projects/:id/guide/nudge", { preHandler: requireUser }, async (request, reply) => {
    const ctx = await loadContext(request, reply);
    if (!ctx) return;
    if (!rateLimiter.consume("guide", request.user!.id)) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    try {
      const suggestion = await guide.nudge(ctx);
      return reply.send({ suggestion });
    } catch {
      return reply.code(503).send({ error: "guide_unavailable" });
    }
  });
};
