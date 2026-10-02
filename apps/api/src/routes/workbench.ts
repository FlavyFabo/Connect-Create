import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import {
  createMilestoneInputSchema,
  createNoteInputSchema,
  updateMilestoneInputSchema,
} from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { getProject, isProjectMember } from "../services/project";
import {
  addNote,
  confirmMilestone,
  createMilestone,
  deleteMilestone,
  getMilestoneById,
  getWorkbench,
  updateMilestone,
} from "../services/workbench";

type Opts = { db: Db };

export const workbenchRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db } = opts;
  const requireUser = makeRequireUser(db);

  async function requireMembership(
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
  ): Promise<boolean> {
    const project = await getProject(db, projectId);
    if (!project) {
      await reply.code(404).send({ error: "not_found" });
      return false;
    }
    if (!(await isProjectMember(db, projectId, request.user!.id))) {
      await reply.code(403).send({ error: "forbidden" });
      return false;
    }
    return true;
  }

  app.get("/projects/:id/workbench", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireMembership(request, reply, id))) return;
    return reply.send(await getWorkbench(db, id));
  });

  app.post("/projects/:id/milestones", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireMembership(request, reply, id))) return;
    const parsed = createMilestoneInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const milestone = await createMilestone(db, id, parsed.data.title);
    return reply.code(201).send({ id: milestone.id });
  });

  app.post("/projects/:id/notes", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!(await requireMembership(request, reply, id))) return;
    const parsed = createNoteInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const note = await addNote(db, id, request.user!.id, parsed.data.body);
    return reply.code(201).send({ id: note.id });
  });

  app.patch("/milestones/:id", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const milestone = await getMilestoneById(db, id);
    if (!milestone) return reply.code(404).send({ error: "not_found" });
    if (!(await requireMembership(request, reply, milestone.projectId))) return;

    const parsed = updateMilestoneInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const result = await updateMilestone(db, milestone, request.user!.id, parsed.data);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send({ milestone: result.milestone });
  });

  app.delete("/milestones/:id", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const milestone = await getMilestoneById(db, id);
    if (!milestone) return reply.code(404).send({ error: "not_found" });
    if (!(await requireMembership(request, reply, milestone.projectId))) return;
    await deleteMilestone(db, milestone);
    return reply.send({ ok: true });
  });

  app.post("/milestones/:id/confirm", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const milestone = await getMilestoneById(db, id);
    if (!milestone) return reply.code(404).send({ error: "not_found" });
    if (!(await requireMembership(request, reply, milestone.projectId))) return;

    const result = await confirmMilestone(db, milestone, request.user!.id);
    if (!result.ok) {
      const status = result.error === "self_confirm" ? 403 : 400;
      return reply.code(status).send({ error: result.error });
    }
    return reply.send({ milestone: result.milestone });
  });
};
