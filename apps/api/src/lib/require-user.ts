import type { FastifyReply, FastifyRequest } from "fastify";
import type { Db } from "../db/client";
import { getSessionUser, type UserRow } from "../services/auth";

export const SESSION_COOKIE = "cc_session";

declare module "fastify" {
  interface FastifyRequest {
    user?: UserRow;
    sessionToken?: string;
  }
}

export function makeRequireUser(db: Db) {
  return async function requireUser(request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    const user = await getSessionUser(db, token);
    if (!user) {
      return reply.code(401).send({ error: "unauthenticated" });
    }
    request.user = user;
    request.sessionToken = token;
  };
}
