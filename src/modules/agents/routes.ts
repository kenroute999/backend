import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import {
  assertEmailFree,
  idParam,
  isPrismaError,
  listQuery,
  loginEmail,
  mobile,
  newPassword,
  personName,
} from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const createSchema = z.strictObject({
  name: personName,
  phone: mobile,
  email: loginEmail,
  password: newPassword,
  commissionPct: z.number().min(0).max(100),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

// Never select passwordHash.
const publicFields = {
  id: true,
  name: true,
  phone: true,
  email: true,
  isActive: true,
  agentCode: true,
  commissionPct: true,
  createdAt: true,
} as const;

const EMAIL_TAKEN = "This email is already in use";

async function newAgentCode(operatorId: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const agentCode = `AGT${Math.floor(1000 + Math.random() * 9000)}`;
    if (!(await prisma.agent.findFirst({ where: { operatorId, agentCode }, select: { id: true } }))) return agentCode;
  }
  throw new AppError(500, "INTERNAL", "Could not allocate an agent code");
}

export const agentsRouter = Router();

agentsRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = {
    operatorId: req.operatorId,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" as const } },
            { email: { contains: q.search, mode: "insensitive" as const } },
            { phone: { contains: q.search } },
            { agentCode: { contains: q.search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      select: publicFields,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.agent.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
});

agentsRouter.post("/", async (req, res) => {
  const { password, ...body } = createSchema.parse(req.body);
  const operatorId = req.operatorId;
  await assertEmailFree(body.email);
  try {
    const agent = await prisma.agent.create({
      data: {
        ...body,
        operatorId,
        passwordHash: await bcrypt.hash(password, 10),
        agentCode: await newAgentCode(operatorId),
      },
      select: publicFields,
    });
    res.status(201).json(agent);
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", EMAIL_TAKEN);
    throw err;
  }
});

agentsRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateSchema.parse(req.body);

  const existing = await prisma.agent.findFirst({ where: { id, operatorId: req.operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Agent not found");
  if (body.email !== undefined) await assertEmailFree(body.email, id);

  try {
    const agent = await prisma.agent.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.email !== undefined && { email: body.email }),
        ...(body.commissionPct !== undefined && { commissionPct: body.commissionPct }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
        ...(body.password !== undefined && {
          passwordHash: await bcrypt.hash(body.password, 10),
          mustChangePassword: true,
        }),
      },
      select: publicFields,
    });
    // A deactivated agent, or one whose password was reset, must not keep old sessions.
    if (body.password !== undefined || body.isActive === false) {
      await prisma.refreshToken.updateMany({
        where: { accountType: "AGENT", accountId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    res.json(agent);
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", EMAIL_TAKEN);
    throw err;
  }
});

agentsRouter.delete("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const existing = await prisma.agent.findFirst({ where: { id, operatorId: req.operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Agent not found");

  try {
    await prisma.agent.delete({ where: { id } });
  } catch (err) {
    // Referenced by bookings or commission rows: history must be kept.
    if (isPrismaError(err, "P2003")) {
      throw new AppError(409, "CONFLICT", "This agent has bookings. Set them to Inactive instead.");
    }
    throw err;
  }
  await prisma.refreshToken.deleteMany({ where: { accountType: "AGENT", accountId: id } });
  res.status(204).end();
});
