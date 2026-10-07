import crypto from "node:crypto";
import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "./config";
import { prisma } from "./db";
import { AppError } from "./errors";

/** Which table the account lives in: User (owners), Agent or Conductor. */
export type Role = "OWNER" | "AGENT" | "CONDUCTOR";

export interface AuthContext {
  userId: string;
  operatorId: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth: AuthContext;
      /** Shortcut for auth.operatorId: every query must be scoped by it. */
      operatorId: string;
    }
  }
}

const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const claims = z.object({
  userId: z.uuid(),
  operatorId: z.uuid(),
  role: z.enum(["OWNER", "AGENT", "CONDUCTOR"]),
});

export function signAccessToken(ctx: AuthContext): string {
  return jwt.sign(ctx, config.jwtAccessSecret, { expiresIn: ACCESS_TOKEN_TTL, algorithm: "HS256" });
}

/** Refresh tokens are random, and only their hash is stored. */
export function newRefreshToken() {
  const token = crypto.randomBytes(48).toString("base64url");
  return { token, tokenHash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

const unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Please sign in again");

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw unauthenticated();
  let payload: unknown;
  try {
    payload = jwt.verify(header.slice(7), config.jwtAccessSecret, { algorithms: ["HS256"] });
  } catch {
    throw unauthenticated();
  }
  const parsed = claims.safeParse(payload);
  if (!parsed.success) throw unauthenticated();

  req.auth = parsed.data;
  req.operatorId = parsed.data.operatorId;
  next();
};

/**
 * A token stays valid for 15 minutes after it is issued. This closes that gap: an
 * account the owner has disabled or deleted is refused on its very next request.
 * Runs after requireRole, so a wrong-role token still gets 403.
 */
export const requireActive: RequestHandler = async (req, _res, next) => {
  const where = { id: req.auth.userId, operatorId: req.auth.operatorId, isActive: true };
  const found =
    req.auth.role === "OWNER"
      ? await prisma.user.count({ where })
      : req.auth.role === "AGENT"
        ? await prisma.agent.count({ where })
        : await prisma.conductor.count({ where });
  if (found === 0) throw unauthenticated();
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(req.auth.role)) throw new AppError(403, "FORBIDDEN", "You do not have access to this");
    next();
  };
}
