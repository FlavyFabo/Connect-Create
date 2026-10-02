import type { FastifyPluginAsync } from "fastify";
import { reportInputSchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { createReport } from "../services/reports";

type Opts = { db: Db };

export const reportRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db } = opts;
  const requireUser = makeRequireUser(db);

  app.post("/reports", { preHandler: requireUser }, async (request, reply) => {
    const parsed = reportInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const report = await createReport(db, request.user!.id, parsed.data);
    if (!report) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.code(201).send(report);
  });
};
