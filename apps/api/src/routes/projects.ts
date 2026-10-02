import type { FastifyPluginAsync } from "fastify";
import { createProjectInputSchema, listProjectsQuerySchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { createProject, getProject, listProjects } from "../services/project";
import { getProjectProgress } from "../services/progress";
import { getProfile, normalizeTags } from "../services/profile";
import { needsFirstCollaborator, rankCandidatesForProject, rankProjectsForUser } from "../services/match";

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
    const { skills, category, cursor, sort } = parsed.data;
    const skillsFilter = skills ? normalizeTags(skills.split(",")) : undefined;

    if (sort === "match") {
      const profile = await getProfile(db, request.user!.id);
      const seed = Math.floor(Math.random() * 0xffffffff);
      const items = await rankProjectsForUser(
        db,
        { id: request.user!.id, skills: profile.skills, availability: profile.availability },
        seed,
      );
      const filtered = items.filter(
        (i) =>
          (!category || i.project.category === category) &&
          (!skillsFilter || skillsFilter.length === 0 || skillsFilter.some((s) => i.project.skillsNeeded.includes(s))),
      );
      const pageSize = 20;
      const offset = cursor ? Number.parseInt(cursor, 10) || 0 : 0;
      const page = filtered.slice(offset, offset + pageSize);
      return reply.send({ items: page, nextCursor: filtered.length > offset + pageSize ? String(offset + pageSize) : null });
    }

    const result = await listProjects(db, {
      ...(skillsFilter && skillsFilter.length > 0 ? { skills: skillsFilter } : {}),
      ...(category ? { category } : {}),
      ...(cursor ? { cursor } : {}),
    });
    return reply.send(result);
  });

  app.get("/projects/needs-first-collaborator", { preHandler: requireUser }, async (request, reply) => {
    const items = await needsFirstCollaborator(db);
    return reply.send({ items });
  });

  app.get("/projects/:id/candidates", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) {
      return reply.code(404).send({ error: "not_found" });
    }
    if (project.ownerId !== request.user!.id) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const seed = Math.floor(Math.random() * 0xffffffff);
    const items = await rankCandidatesForProject(db, id, seed);
    return reply.send({ items });
  });

  app.get("/projects/:id", { preHandler: requireUser }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await getProject(db, id);
    if (!project) {
      return reply.code(404).send({ error: "not_found" });
    }
    const progress = await getProjectProgress(db, id);
    return reply.send({ project, progress });
  });
};
