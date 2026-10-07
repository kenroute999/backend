import { Router } from "express";
import { z } from "zod";
import { idParam, isInUseError, isPrismaError, listQuery, mobile, personName } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const createSchema = z.strictObject({
  name: personName,
  phone: mobile,
  licenseNo: z.string().trim().toUpperCase().min(5).max(20),
  experienceYears: z.number().int().min(0).max(60),
  isActive: z.boolean().default(true),
});

// The trip (bus + route + date and time) the driver is put on. null clears it.
const assignment = { tripId: z.uuid().nullable().optional() };
const createWithTrip = createSchema.extend(assignment);
const updateSchema = createSchema.partial().extend(assignment);

const tripFields = {
  id: true,
  departureAt: true,
  arrivalAt: true,
  bus: { select: { id: true, registrationNo: true, name: true } },
  route: { select: { id: true, origin: true, destination: true } },
} as const;

const upcoming = () => ({ status: "SCHEDULED" as const, departureAt: { gte: new Date() } });

// `trips` holds at most the next upcoming assignment.
function fields() {
  return {
    id: true,
    name: true,
    phone: true,
    licenseNo: true,
    experienceYears: true,
    isActive: true,
    createdAt: true,
    trips: { where: upcoming(), orderBy: { departureAt: "asc" as const }, take: 1, select: tripFields },
  } as const;
}

function present<T extends { trips: unknown[] }>({ trips, ...driver }: T) {
  return { ...driver, trip: trips[0] ?? null };
}

/** The trip must be this company's, still to run, and not already driven by someone else. */
async function assertTripOpen(operatorId: string, tripId: string, driverId?: string) {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, operatorId, ...upcoming() },
    select: { driver: { select: { id: true, name: true } } },
  });
  // A trip from another operator must look exactly like one that does not exist.
  if (!trip) throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { tripId: "Upcoming trip not found" });
  if (trip.driver && trip.driver.id !== driverId) {
    throw new AppError(409, "CONFLICT", `This trip is already assigned to ${trip.driver.name}`);
  }
}

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
    prisma.driver.findMany({ where, select: fields(), orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.driver.count({ where }),
  ]);
  res.json({ items: items.map(present), total, page: q.page, limit: q.limit });
});

driversRouter.post("/", async (req, res) => {
  const { tripId, ...body } = createWithTrip.parse(req.body);
  const operatorId = req.operatorId;
  if (tripId) await assertTripOpen(operatorId, tripId);
  try {
    const id = await prisma.$transaction(async (tx) => {
      const driver = await tx.driver.create({ data: { ...body, operatorId }, select: { id: true } });
      if (tripId) await tx.trip.update({ where: { id: tripId }, data: { driverId: driver.id } });
      return driver.id;
    });
    res.status(201).json(present(await prisma.driver.findUniqueOrThrow({ where: { id }, select: fields() })));
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", DUPLICATE_LICENCE);
    throw err;
  }
});

driversRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { tripId, ...body } = updateSchema.parse(req.body);
  const operatorId = req.operatorId;

  const existing = await prisma.driver.findFirst({ where: { id, operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Driver not found");
  if (tripId) await assertTripOpen(operatorId, tripId, id);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.driver.update({
        where: { id },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.phone !== undefined && { phone: body.phone }),
          ...(body.licenseNo !== undefined && { licenseNo: body.licenseNo }),
          ...(body.experienceYears !== undefined && { experienceYears: body.experienceYears }),
          ...(body.isActive !== undefined && { isActive: body.isActive }),
        },
      });
      if (tripId !== undefined) {
        // ponytail: this form holds one upcoming assignment per driver, as for conductors,
        // so picking a trip replaces the previous one.
        await tx.trip.updateMany({ where: { operatorId, driverId: id, ...upcoming() }, data: { driverId: null } });
        if (tripId) await tx.trip.update({ where: { id: tripId }, data: { driverId: id } });
      }
    });
    res.json(present(await prisma.driver.findUniqueOrThrow({ where: { id }, select: fields() })));
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
    await prisma.$transaction(async (tx) => {
      // Trips not yet run just lose their driver; trips already run keep the record and block the delete.
      await tx.trip.updateMany({ where: { operatorId: req.operatorId, driverId: id, ...upcoming() }, data: { driverId: null } });
      await tx.driver.delete({ where: { id } });
    });
  } catch (err) {
    if (isInUseError(err)) {
      throw new AppError(409, "CONFLICT", "This driver has past trips. Set them to Inactive instead.");
    }
    throw err;
  }
  res.status(204).end();
});
