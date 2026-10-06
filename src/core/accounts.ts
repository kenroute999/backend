import { z } from "zod";
import { prisma } from "./db";
import { AppError } from "./errors";

// Field rules shared by every staff form.
export const personName = z.string().trim().min(2).max(60);
export const mobile = z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number");
export const loginEmail = z.string().trim().toLowerCase().pipe(z.email());
// bcrypt ignores everything past 72 bytes.
export const newPassword = z.string().min(8).max(72);
export const idParam = z.object({ id: z.uuid() });

export const listQuery = z.object({
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export function isPrismaError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === code;
}

/**
 * Login emails live in two tables (User for owners, Agent) and must not
 * repeat across them, or sign-in could not tell which account is meant.
 * Conductors sign in with their mobile number instead.
 */
export async function assertEmailFree(email: string, exceptId?: string) {
  const where = { email, ...(exceptId ? { NOT: { id: exceptId } } : {}) };
  const select = { id: true } as const;
  const [user, agent] = await Promise.all([
    prisma.user.findFirst({ where, select }),
    prisma.agent.findFirst({ where, select }),
  ]);
  if (user || agent) throw new AppError(409, "CONFLICT", "This email is already in use");
}
