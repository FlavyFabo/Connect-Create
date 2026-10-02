import type { FastifyPluginAsync } from "fastify";
import { profileInputSchema } from "@connect-create/shared";
import type { Db } from "../db/client";
import { makeRequireUser } from "../lib/require-user";
import { publicUser } from "../services/auth";
import { getProfile, updateProfile } from "../services/profile";

type Opts = { db: Db };

export const meRoutes: FastifyPluginAsync<Opts> = async (app, opts) => {
  const { db } = opts;
  const requireUser = makeRequireUser(db);

  app.get("/me", { preHandler: requireUser }, async (request, reply) => {
    const profile = await getProfile(db, request.user!.id);
    return reply.send({ user: publicUser(request.user!), profile, progress: 0 });
  });

  app.put("/me/profile", { preHandler: requireUser }, async (request, reply) => {
    const parsed = profileInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: "invalid_input", issues: parsed.error.issues.map((i) => i.message) });
    }
    const result = await updateProfile(db, request.user!.id, parsed.data);
    if (!result.ok) {
      return reply.code(400).send({ error: result.error });
    }
    return reply.send({ profile: result.profile });
  });
};
