import type { FastifyPluginAsync } from "fastify";
import { createProjectInputSchema, listProjectsQuerySchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { createProject, getProject, listProjects } from "../services/project";
import { normalizeTags } from "../services/profile";

type Opts = { db: Db };

export const projectRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db } = opts;
  const requireUser = makeRequireUser(db);

  app.post("/projects", { preHandler: requireUser }, async (request, reply) => {
    const parsed = createProjectInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const result = await createProject(db, request.user!.id, parsed.data);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.code(201).send({ id: result.id });
  });

  app.get("/projects", { preHandler: requireUser }, async (request, reply) => {
    const parsed = listProjectsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const { skills, category, cursor } = parsed.data;
    const skillsFilter = skills ? normalizeTags(skills.split(",")) : undefined;
    const result = await listProjects(db, {
      ...(skillsFilter && skillsFilter.length > 0 ? { skills: skillsFilter } : {}),
      ...(category ? { category } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return reply.send(result);
  });

  app.get("/projects/:id", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.send({ project, progress: 0 });
  });
};
