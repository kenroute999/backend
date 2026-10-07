import bcrypt from "bcrypt";
import { Router } from "express";
import { z } from "zod";
import { idParam, isInUseError, isPrismaError, listQuery, mobile, newPassword, personName } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const createSchema = z.strictObject({
  name: personName,
  phone: mobile,
  password: newPassword,
  isActive: z.boolean().default(true),
});

// The trip (bus + route + date and time) is assigned afterwards, from the edit form. null clears it.
const updateSchema = createSchema.partial().extend({
  tripId: z.uuid().nullable().optional(),
});

const tripFields = {
  id: true,
  departureAt: true,
  arrivalAt: true,
  bus: { select: { id: true, registrationNo: true, name: true } },
  route: { select: { id: true, origin: true, destination: true } },
} as const;

// Never select passwordHash. `trips` holds at most the next upcoming assignment.
function publicFields() {
  return {
    id: true,
    name: true,
    phone: true,
    isActive: true,
    createdAt: true,
    trips: {
      where: { status: "SCHEDULED", departureAt: { gte: new Date() } },
      orderBy: { departureAt: "asc" },
      take: 1,
      select: tripFields,
    },
  } as const;
}

function present<T extends { trips: unknown[] }>({ trips, ...conductor }: T) {
  return { ...conductor, trip: trips[0] ?? null };
}

/**
 * A mobile number is one conductor login across every company. The owner is told about
 * their own conductor; a number held by another company gets a plain refusal, so nothing
 * is said about someone else's staff.
 */
async function phoneTaken(operatorId: string, phone?: string) {
  const own = phone && (await prisma.conductor.findFirst({ where: { operatorId, phone }, select: { name: true } }));
  return new AppError(
    409,
    "CONFLICT",
    own ? `This mobile number is already used by your conductor ${own.name}` : "This mobile number cannot be used. Enter a different number.",
  );
}

export const conductorsRouter = Router();

conductorsRouter.get("/", async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = {
    operatorId: req.operatorId,
    ...(q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { phone: { contains: q.search } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.conductor.findMany({
      where,
      select: publicFields(),
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * q.limit,
      take: q.limit,
    }),
    prisma.conductor.count({ where }),
  ]);
  res.json({ items: items.map(present), total, page: q.page, limit: q.limit });
});

conductorsRouter.post("/", async (req, res) => {
  const { password, ...body } = createSchema.parse(req.body);
  try {
    const conductor = await prisma.conductor.create({
      data: { ...body, operatorId: req.operatorId, passwordHash: await bcrypt.hash(password, 10) },
      select: publicFields(),
    });
    res.status(201).json(present(conductor));
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw await phoneTaken(req.operatorId, body.phone);
    throw err;
  }
});

conductorsRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { tripId, ...body } = updateSchema.parse(req.body);
  const operatorId = req.operatorId;

  const existing = await prisma.conductor.findFirst({ where: { id, operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Conductor not found");

  if (tripId) {
    // A trip from another operator must look exactly like one that does not exist.
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, operatorId, status: "SCHEDULED", departureAt: { gte: new Date() } },
      select: { conductor: { select: { id: true, name: true } } },
    });
    if (!trip) throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { tripId: "Upcoming trip not found" });
    if (trip.conductor && trip.conductor.id !== id) {
      throw new AppError(409, "CONFLICT", `This trip is already assigned to ${trip.conductor.name}`);
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.conductor.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
          ...(body.password !== undefined && {
            passwordHash: await bcrypt.hash(body.password, 10),
            mustChangePassword: true,
          }),
        },
      });
      if (tripId !== undefined) {
        // ponytail: this form holds one upcoming assignment per conductor, so picking a trip replaces the
        // previous one. Assigning several trips at once belongs to the Trips screen.
        await tx.trip.updateMany({
          where: { operatorId, conductorId: id, status: "SCHEDULED", departureAt: { gte: new Date() } },
          data: { conductorId: null },
        });
        if (tripId) await tx.trip.update({ where: { id: tripId }, data: { conductorId: id } });
      }
      // A deactivated conductor, or one whose password was reset, must not keep old sessions.
      if (body.password !== undefined || body.isActive === false) {
        await tx.refreshToken.updateMany({
          where: { accountType: "CONDUCTOR", accountId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
    });
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw await phoneTaken(req.operatorId, body.phone);
    throw err;
  }

  const conductor = await prisma.conductor.findUniqueOrThrow({ where: { id }, select: publicFields() });
  res.json(present(conductor));
});

conductorsRouter.delete("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const operatorId = req.operatorId;
  const existing = await prisma.conductor.findFirst({ where: { id, operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Conductor not found");

  try {
    await prisma.$transaction(async (tx) => {
      // Trips not yet run just lose their conductor; trips already run keep the record and block the delete.
      await tx.trip.updateMany({
        where: { operatorId, conductorId: id, status: "SCHEDULED", departureAt: { gte: new Date() } },
        data: { conductorId: null },
      });
      await tx.conductor.delete({ where: { id } });
      await tx.refreshToken.deleteMany({ where: { accountType: "CONDUCTOR", accountId: id } });
    });
  } catch (err) {
    if (isInUseError(err)) {
      throw new AppError(409, "CONFLICT", "This conductor has past trips. Set them to Inactive instead.");
    }
    throw err;
  }
  res.status(204).end();
});
