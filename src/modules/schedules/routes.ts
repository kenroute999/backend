import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";
import { assertBusFree, createTripWithSeats, fareFor, faresSchema, type Fares } from "../trips/service";

// What the owner's Routes screen manages: a route, the bus running it, when, and at what fares.
// Each row is one trip; its origin and destination are kept in the shared Route table,
// so everything an owner saves here is what agents can sell.
export const schedulesRouter = Router();

const place = z.string().trim().min(2).max(60);
const stops = z.array(z.string().trim().min(1).max(80)).max(30);
// The owner picks these. "In transit" and "completed" follow from the clock.
const status = z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]);

const createSchema = z.strictObject({
  origin: place,
  destination: place,
  busId: z.uuid(),
  departureAt: z.coerce.date(),
  arrivalAt: z.coerce.date(),
  boardingPoints: stops.default([]),
  droppingPoints: stops.default([]),
  fares: faresSchema,
  status: status.default("ACTIVE"),
});
const updateSchema = createSchema.partial();

const TO_TRIP_STATUS = { ACTIVE: "SCHEDULED", MAINTENANCE: "MAINTENANCE", INACTIVE: "CANCELLED" } as const;

const tripFields = {
  id: true,
  departureAt: true,
  arrivalAt: true,
  fare: true,
  fares: true,
  status: true,
  route: { select: { id: true, origin: true, destination: true, boardingPoints: true, droppingPoints: true } },
  bus: { select: { id: true, registrationNo: true, name: true, isAc: true, seating: true } },
  conductor: { select: { id: true, name: true } },
  _count: { select: { seats: true, bookings: true } },
} as const;

function sameCity(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** Finds the operator's route between two places, or creates it, and applies the given stops. */
async function routeBetween(
  operatorId: string,
  origin: string,
  destination: string,
  fare: number,
  points: { boardingPoints?: string[] | undefined; droppingPoints?: string[] | undefined },
) {
  if (sameCity(origin, destination)) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { destination: "Must differ from the source" });
  }
  const existing = await prisma.route.findFirst({
    where: {
      operatorId,
      origin: { equals: origin, mode: "insensitive" },
      destination: { equals: destination, mode: "insensitive" },
    },
  });
  if (!existing) {
    return prisma.route.create({
      data: {
        operatorId,
        origin,
        destination,
        baseFare: fare,
        boardingPoints: points.boardingPoints ?? [],
        droppingPoints: points.droppingPoints ?? [],
      },
    });
  }
  return prisma.route.update({
    where: { id: existing.id },
    data: {
      isActive: true,
      ...(points.boardingPoints && { boardingPoints: points.boardingPoints }),
      ...(points.droppingPoints && { droppingPoints: points.droppingPoints }),
    },
  });
}

const lowest = (fares: Fares) => Math.min(...Object.values(fares).filter((v): v is number => typeof v === "number"));

function requireAFare(fares: Fares) {
  if (Object.values(fares).every((v) => v === undefined)) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { fares: "Enter at least one fare" });
  }
}

schedulesRouter.get("/", async (req, res) => {
  const items = await prisma.trip.findMany({
    where: { operatorId: req.operatorId },
    select: tripFields,
    orderBy: { departureAt: "desc" },
    take: 200,
  });
  res.json({ items, total: items.length });
});

schedulesRouter.post("/", async (req, res) => {
  const body = createSchema.parse(req.body);
  const operatorId = req.operatorId;
  requireAFare(body.fares);

  const route = await routeBetween(operatorId, body.origin, body.destination, lowest(body.fares), body);
  const trip = await createTripWithSeats(operatorId, {
    busId: body.busId,
    routeId: route.id,
    departureAt: body.departureAt,
    arrivalAt: body.arrivalAt,
    fares: body.fares,
  });
  const saved = await prisma.trip.update({
    where: { id: trip.id },
    data: { status: TO_TRIP_STATUS[body.status] },
    select: tripFields,
  });
  res.status(201).json(saved);
});

schedulesRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const body = updateSchema.parse(req.body);
  const operatorId = req.operatorId;

  const trip = await prisma.trip.findFirst({
    where: { id, operatorId },
    include: { route: true, _count: { select: { bookings: true } } },
  });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Route not found");

  const sold = await prisma.booking.count({ where: { tripId: id, status: { in: ["CONFIRMED", "BOARDED"] } } });
  const busChanges = body.busId !== undefined && body.busId !== trip.busId;
  const placeChanges =
    (body.origin !== undefined && !sameCity(body.origin, trip.route.origin)) ||
    (body.destination !== undefined && !sameCity(body.destination, trip.route.destination));
  const takenOffSale = body.status !== undefined && body.status !== "ACTIVE";
  // Passengers hold tickets for this bus, on this route: those cannot change under them.
  if (sold > 0 && (busChanges || placeChanges || takenOffSale)) {
    throw new AppError(
      409,
      "CONFLICT",
      `${sold} seat(s) are already sold on this trip. Cancel those tickets before changing the bus, the route or taking it off sale.`,
    );
  }

  const departureAt = body.departureAt ?? trip.departureAt;
  const arrivalAt = body.arrivalAt ?? trip.arrivalAt;
  const busId = body.busId ?? trip.busId;
  if (body.busId !== undefined || body.departureAt !== undefined || body.arrivalAt !== undefined) {
    await assertBusFree(operatorId, busId, departureAt, arrivalAt, id);
  }
  if (busChanges && !(await prisma.bus.findFirst({ where: { id: busId, operatorId }, select: { id: true } }))) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { busId: "Bus not found" });
  }

  const fares = body.fares ?? ((trip.fares ?? {}) as Fares);
  if (body.fares) requireAFare(body.fares);
  const fallback = Number(trip.fare);

  const route =
    placeChanges || body.boardingPoints || body.droppingPoints
      ? await routeBetween(operatorId, body.origin ?? trip.route.origin, body.destination ?? trip.route.destination, fallback, body)
      : trip.route;

  await prisma.$transaction(async (tx) => {
    if (busChanges) {
      // Nothing is sold (checked above), so the seats can be rebuilt from the new bus's layout.
      const bus = await tx.bus.findUniqueOrThrow({ where: { id: busId }, include: { seatLayout: true } });
      const layout = z
        .array(z.object({ number: z.string(), deck: z.enum(["LOWER", "UPPER"]), row: z.number(), col: z.number(), type: z.string().default("SLEEPER") }))
        .parse(bus.seatLayout.seats);
      await tx.tripSeat.deleteMany({ where: { tripId: id } });
      await tx.tripSeat.createMany({
        data: layout.map((s) => ({
          operatorId,
          tripId: id,
          seatNumber: s.number,
          deck: s.deck,
          row: s.row,
          col: s.col,
          seatType: s.type,
          fare: fareFor(s.type, fares, fallback),
        })),
      });
    } else if (body.fares) {
      // New prices apply to seats still on sale; sold seats keep the fare they were sold at.
      const open = await tx.tripSeat.findMany({ where: { tripId: id, status: { not: "BOOKED" } }, select: { id: true, seatType: true } });
      for (const seat of open) {
        await tx.tripSeat.update({ where: { id: seat.id }, data: { fare: fareFor(seat.seatType, fares, fallback) } });
      }
    }
    await tx.trip.update({
      where: { id },
      data: {
        busId,
        routeId: route.id,
        departureAt,
        arrivalAt,
        ...(body.fares && { fares: body.fares, fare: lowest(body.fares) }),
        ...(body.status && { status: TO_TRIP_STATUS[body.status] }),
      },
    });
  });

  res.json(await prisma.trip.findUniqueOrThrow({ where: { id }, select: tripFields }));
});

schedulesRouter.delete("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const trip = await prisma.trip.findFirst({
    where: { id, operatorId: req.operatorId },
    select: { _count: { select: { bookings: true } } },
  });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Route not found");
  // Bookings, even cancelled ones, are history that must stay readable.
  if (trip._count.bookings > 0) {
    throw new AppError(409, "CONFLICT", "This trip has bookings. Set it to Inactive instead of deleting it.");
  }
  await prisma.trip.delete({ where: { id } });
  res.status(204).end();
});
