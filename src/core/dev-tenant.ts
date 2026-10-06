import type { RequestHandler } from "express";
import { config } from "./config";
import { prisma } from "./db";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operatorId: string;
    }
  }
}

const DEV_OPERATOR_NAME = "Sri Krishna Travels";
let cachedId: string | undefined;

/**
 * TEMPORARY, development only: treats every request as coming from the demo
 * operator's owner so screens can be wired before login exists. Must be
 * replaced by requireAuth + requireRole before anything is deployed.
 */
export const devTenant: RequestHandler = async (req, _res, next) => {
  if (config.nodeEnv === "production") {
    throw new Error("devTenant must not run in production: wire real authentication");
  }
  if (!cachedId) {
    const existing = await prisma.operator.findFirst({ where: { name: DEV_OPERATOR_NAME } });
    cachedId = (existing ?? (await prisma.operator.create({ data: { name: DEV_OPERATOR_NAME } }))).id;
  }
  req.operatorId = cachedId;
  next();
};

/** Tests reset the database between runs. */
export function resetDevTenant() {
  cachedId = undefined;
}
