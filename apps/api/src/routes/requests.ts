import type { FastifyPluginAsync } from "fastify";
import { createMessageInputSchema, createRequestInputSchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { getProject, isProjectMember } from "../services/project";
import {
  acceptRequest,
  addMessage,
  createRequest,
  declineRequest,
  getRequestById,
  listMessages,
  listProjectRequests,
} from "../services/requests";

import type { RateLimiter } from "../lib/rate-limit";

type Opts = { db: Db; rateLimiter: RateLimiter };

const CREATE_ERRORS: Record<string, number> = {
  not_found: 404,
  forbidden: 403,
  not_owner: 403,
  already_member: 400,
  target_is_member: 400,
  duplicate_pending: 400,
};

export const requestRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db, rateLimiter } = opts;
  const requireUser = makeRequireUser(db);

  app.post("/projects/:id/requests", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!rateLimiter.consume("join_request", request.user!.id)) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    const parsed = createRequestInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const result = await createRequest(db, id, request.user!.id, parsed.data);
    if (!result.ok) {
      return reply.code(CREATE_ERRORS[result.error] ?? 400).send({ error: result.error });
    }
    return reply.code(201).send({ id: result.request.id });
  });

  app.get("/projects/:id/requests", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (project.ownerId !== request.user!.id) return reply.code(403).send({ error: "forbidden" });
    return reply.send({ items: await listProjectRequests(db, id) });
  });

  for (const action of ["accept", "decline"] as const) {
    app.post(`/requests/:id/${action}`, { preHandler: requireUser }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const req = await getRequestById(db, id);
      if (!req) return reply.code(404).send({ error: "not_found" });
      const result =
        action === "accept"
          ? await acceptRequest(db, req, request.user!.id)
          : await declineRequest(db, req, request.user!.id);
      if (!result.ok) {
        const status = result.error === "forbidden" ? 403 : 400;
        return reply.code(status).send({ error: result.error });
      }
      return reply.send({ request: result.request });
    });
  }

  app.post("/projects/:id/messages", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (!(await isProjectMember(db, id, request.user!.id))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (!rateLimiter.consume("message", request.user!.id)) {
      return reply.code(429).send({ error: "rate_limited" });
    }
    const parsed = createMessageInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const message = await addMessage(db, id, request.user!.id, parsed.data.body);
    return reply.code(201).send({ id: message.id });
  });

  app.get("/projects/:id/messages", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (!(await isProjectMember(db, id, request.user!.id))) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return reply.send({ items: await listMessages(db, id) });
  });
};
