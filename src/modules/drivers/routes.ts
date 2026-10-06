import { Router } from "express";
import { z } from "zod";
import { idParam, isPrismaError, listQuery, mobile, personName } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const createSchema = z.strictObject({
  name: personName,
  phone: mobile,
  licenseNo: z.string().trim().toUpperCase().min(5).max(20),
  experienceYears: z.number().int().min(0).max(60),
  isActive: z.boolean().default(true),
});

const updateSchema = createSchema.partial();

const DUPLICATE_LICENCE = "A driver with this licence number already exists";

export const driversRouter = Router();

driversRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = {
    operatorId: req.operatorId,
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: "insensitive" as const } },
            { licenseNo: { contains: q.search, mode: "insensitive" as const } },
            { phone: { contains: q.search } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.driver.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.driver.count({ where }),
  ]);
  res.json({ items, total, page: q.page, limit: q.limit });
});

driversRouter.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  try {
    const driver = await prisma.driver.create({ data: { ...body, operatorId: req.operatorId } });
    res.status(201).json(driver);
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", DUPLICATE_LICENCE);
    throw err;
  }
});

driversRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateSchema.parse(req.body);

  const existing = await prisma.driver.findFirst({ where: { id, operatorId: req.operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Driver not found");

  try {
    const driver = await prisma.driver.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.phone !== undefined && { phone: body.phone }),
        ...(body.licenseNo !== undefined && { licenseNo: body.licenseNo }),
        ...(body.experienceYears !== undefined && { experienceYears: body.experienceYears }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.json(driver);
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", DUPLICATE_LICENCE);
    throw err;
  }
});

driversRouter.delete("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const existing = await prisma.driver.findFirst({ where: { id, operatorId: req.operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Driver not found");

  try {
    await prisma.driver.delete({ where: { id } });
  } catch (err) {
    // Referenced by trips: history must be kept.
    if (isPrismaError(err, "P2003")) {
      throw new AppError(409, "CONFLICT", "This driver has trips. Set them to Inactive instead.");
    }
    throw err;
  }
  res.status(204).end();
});
