import bcrypt from "bcrypt";
import { Router, type Request, type RequestHandler, type Response } from "express";
import { MemoryStore, rateLimit } from "express-rate-limit";
import { z } from "zod";
import { loginEmail, mobile, newPassword } from "../../core/accounts";
import {
  hashRefreshToken,
  newRefreshToken,
  REFRESH_TOKEN_TTL_MS,
  requireAuth,
  signAccessToken,
  type Role,
} from "../../core/auth";
import { config } from "../../core/config";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const REFRESH_COOKIE = "kr_refresh";
// Compared against when no account matches, so unknown and known logins take the same time.
const DUMMY_HASH = bcrypt.hashSync("no-such-account", 10);

interface Account {
  type: Role;
  id: string;
  operatorId: string;
  passwordHash: string;
  isActive: boolean;
  user: Record<string, unknown>;
}

const operatorName = { operator: { select: { name: true } } } as const;

type Row = { id: string; operatorId: string; passwordHash: string; isActive: boolean; operator: { name: string } };

function account(type: Role, row: Row, user: Record<string, unknown>): Account {
  return {
    type,
    id: row.id,
    operatorId: row.operatorId,
    passwordHash: row.passwordHash,
    isActive: row.isActive,
    user: { id: row.id, role: type, operatorId: row.operatorId, operatorName: row.operator.name, ...user },
  };
}

const fromOwner = (u: Row & { name: string; email: string; phone: string | null; mustChangePassword: boolean }) =>
  account("OWNER", u, { name: u.name, email: u.email, phone: u.phone, mustChangePassword: u.mustChangePassword });

const fromAgent = (
  a: Row & {
    name: string;
    email: string;
    phone: string;
    mustChangePassword: boolean;
    agentCode: string;
    commissionPct: { toString(): string };
  },
) =>
  account("AGENT", a, {
    name: a.name,
    email: a.email,
    phone: a.phone,
    mustChangePassword: a.mustChangePassword,
    agentCode: a.agentCode,
    commissionPct: a.commissionPct.toString(),
  });

const fromConductor = (c: Row & { name: string; phone: string; mustChangePassword: boolean }) =>
  account("CONDUCTOR", c, { name: c.name, phone: c.phone, mustChangePassword: c.mustChangePassword });

async function findByEmail(email: string): Promise<Account | null> {
  const owner = await prisma.user.findUnique({ where: { email }, include: operatorName });
  if (owner) return fromOwner(owner);
  const agent = await prisma.agent.findUnique({ where: { email }, include: operatorName });
  return agent ? fromAgent(agent) : null;
}

async function findByPhone(phone: string): Promise<Account | null> {
  const conductor = await prisma.conductor.findUnique({ where: { phone }, include: operatorName });
  return conductor ? fromConductor(conductor) : null;
}

async function findById(type: Role, id: string): Promise<Account | null> {
  if (type === "OWNER") {
    const row = await prisma.user.findUnique({ where: { id }, include: operatorName });
    return row ? fromOwner(row) : null;
  }
  if (type === "AGENT") {
    const row = await prisma.agent.findUnique({ where: { id }, include: operatorName });
    return row ? fromAgent(row) : null;
  }
  const row = await prisma.conductor.findUnique({ where: { id }, include: operatorName });
  return row ? fromConductor(row) : null;
}

async function setPassword(type: Role, id: string, passwordHash: string) {
  const data = { passwordHash, mustChangePassword: false };
  if (type === "OWNER") await prisma.user.update({ where: { id }, data });
  else if (type === "AGENT") await prisma.agent.update({ where: { id }, data });
  else await prisma.conductor.update({ where: { id }, data });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: config.nodeEnv === "production",
    path: "/api/v1/auth",
  };
}

function readRefreshCookie(req: Request): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === REFRESH_COOKIE) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/** The token arrives in the HTTP-only cookie (browsers) or in the body (clients that hold it themselves). */
function presentedRefreshToken(req: Request): string | undefined {
  const fromBody = z.object({ refreshToken: z.string().min(1).max(200).optional() }).safeParse(req.body ?? {});
  return (fromBody.success ? fromBody.data.refreshToken : undefined) ?? readRefreshCookie(req);
}

async function issueTokens(res: Response, acc: Account) {
  const { token, tokenHash } = newRefreshToken();
  await prisma.refreshToken.create({
    data: {
      operatorId: acc.operatorId,
      accountType: acc.type,
      accountId: acc.id,
      tokenHash,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
    },
  });
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions(), maxAge: REFRESH_TOKEN_TTL_MS });
  return {
    accessToken: signAccessToken({ userId: acc.id, operatorId: acc.operatorId, role: acc.type }),
    refreshToken: token,
    user: acc.user,
  };
}

// --- Login throttling: by address, and by the account being guessed at. ---
const WINDOW_MS = 15 * 60 * 1000;
const ipStore = new MemoryStore();
const idStore = new MemoryStore();
const tooMany: RequestHandler = (_req, _res, next) => {
  next(new AppError(429, "RATE_LIMITED", "Too many attempts. Try again in a few minutes."));
};
const limitByIp = rateLimit({ windowMs: WINDOW_MS, limit: 50, store: ipStore, handler: tooMany, legacyHeaders: false });
const limitByAccount = rateLimit({
  windowMs: WINDOW_MS,
  limit: 8,
  store: idStore,
  handler: tooMany,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => String(req.body?.email ?? req.body?.phone ?? "").trim().toLowerCase() || "anonymous",
});

/** Tests share one process, so they clear the counters between cases. */
export function resetLoginLimits() {
  ipStore.resetAll();
  idStore.resetAll();
  pwStore.resetAll();
}

const loginSchema = z
  .object({ email: loginEmail.optional(), phone: mobile.optional(), password: z.string().min(1).max(200) })
  .refine((v) => (v.email === undefined) !== (v.phone === undefined), {
    message: "Send either email or phone",
    path: ["email"],
  });

export const authRouter = Router();

authRouter.post("/login", limitByIp, limitByAccount, async (req, res) => {
  const body = loginSchema.parse(req.body);
  const acc = body.email !== undefined ? await findByEmail(body.email) : await findByPhone(body.phone!);

  const passwordOk = await bcrypt.compare(body.password, acc?.passwordHash ?? DUMMY_HASH);
  // One answer for "no such account" and "wrong password", so accounts cannot be discovered.
  if (!acc || !passwordOk) throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email, mobile number or password");
  if (!acc.isActive) throw new AppError(403, "FORBIDDEN", "This account has been disabled");

  res.json(await issueTokens(res, acc));
});

authRouter.post("/refresh", async (req, res) => {
  const expired = new AppError(401, "UNAUTHENTICATED", "Please sign in again");
  const token = presentedRefreshToken(req);
  if (!token) throw expired;

  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: hashRefreshToken(token) } });
  if (!stored) throw expired;
  const owner = { accountType: stored.accountType, accountId: stored.accountId };

  if (stored.revokedAt) {
    // A token that was already swapped is being replayed: assume it was stolen and end every session.
    await prisma.refreshToken.updateMany({ where: { ...owner, revokedAt: null }, data: { revokedAt: new Date() } });
    throw expired;
  }
  if (stored.expiresAt <= new Date()) throw expired;

  const acc = await findById(stored.accountType, stored.accountId);
  if (!acc?.isActive) throw expired;

  await prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
  res.json(await issueTokens(res, acc));
});

authRouter.post("/logout", async (req, res) => {
  const token = presentedRefreshToken(req);
  if (token) {
    await prisma.refreshToken.updateMany({
      where: { tokenHash: hashRefreshToken(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

const changePasswordSchema = z.strictObject({ currentPassword: z.string().min(1).max(200), newPassword });

// A stolen access token must not be usable to guess the current password without limit.
const pwStore = new MemoryStore();
const limitPasswordChange = rateLimit({
  windowMs: WINDOW_MS,
  limit: 8,
  store: pwStore,
  handler: tooMany,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${req.auth.role}:${req.auth.userId}`,
});

authRouter.post("/change-password", requireAuth, limitPasswordChange, async (req, res) => {
  const body = changePasswordSchema.parse(req.body);
  const acc = await findById(req.auth.role, req.auth.userId);
  if (!acc?.isActive) throw new AppError(401, "UNAUTHENTICATED", "Please sign in again");
  if (!(await bcrypt.compare(body.currentPassword, acc.passwordHash))) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { currentPassword: "Current password is wrong" });
  }

  await setPassword(acc.type, acc.id, await bcrypt.hash(body.newPassword, 10));
  // Every other device must sign in again with the new password.
  await prisma.refreshToken.updateMany({
    where: { accountType: acc.type, accountId: acc.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  res.clearCookie(REFRESH_COOKIE, cookieOptions());
  res.status(204).end();
});

/** GET /me */
export const me: RequestHandler = async (req, res) => {
  const acc = await findById(req.auth.role, req.auth.userId);
  if (!acc?.isActive) throw new AppError(401, "UNAUTHENTICATED", "Please sign in again");
  res.json(acc.user);
};
