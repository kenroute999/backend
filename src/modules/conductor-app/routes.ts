import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

// Everything here is the signed-in conductor's own work: only trips assigned to them.
export const conductorAppRouter = Router();

const tripFields = {
  id: true,
  departureAt: true,
  arrivalAt: true,
  status: true,
  updatedAt: true,
  bus: { select: { registrationNo: true, name: true } },
  route: { select: { origin: true, destination: true } },
  _count: { select: { seats: true } },
} as const;

/** A trip is visible to a conductor from the day before departure until a day after arrival. */
const DAY_MS = 86_400_000;

async function ownTrip(tripId: string, conductorId: string, operatorId: string) {
  const trip = await prisma.trip.findFirst({ where: { id: tripId, conductorId, operatorId }, select: tripFields });
  // Someone else's trip must look exactly like one that does not exist.
  if (!trip) throw new AppError(404, "NOT_FOUND", "Trip not found");
  return trip;
}

conductorAppRouter.get("/trips", async (req, res) => {
  const items = await prisma.trip.findMany({
    where: {
      operatorId: req.operatorId,
      conductorId: req.auth.userId,
      status: { not: "CANCELLED" },
      arrivalAt: { gte: new Date(Date.now() - DAY_MS) },
    },
    select: tripFields,
    orderBy: { departureAt: "asc" },
    take: 20,
  });
  res.json({ items, total: items.length });
});

// Name, seat and ticket code only: conductors do not see fares or phone numbers.
conductorAppRouter.get("/trips/:id/passengers", async (req, res) => {
  const { id } = idParam.parse(req.params);
  await ownTrip(id, req.auth.userId, req.operatorId);

  const bookings = await prisma.booking.findMany({
    where: { tripId: id, operatorId: req.operatorId, status: { in: ["CONFIRMED", "BOARDED", "COMPLETED"] } },
    select: {
      pnr: true,
      tripSeat: { select: { seatNumber: true } },
      passenger: { select: { id: true, name: true, boarded: true } },
    },
    orderBy: { tripSeat: { seatNumber: "asc" } },
  });
  const items = bookings.flatMap((b) =>
    b.passenger
      ? [{ id: b.passenger.id, tripId: id, name: b.passenger.name, seat: b.tripSeat.seatNumber, pnr: b.pnr, boarded: b.passenger.boarded }]
      : [],
  );
  res.json({ items, total: items.length });
});

const syncSchema = z.strictObject({
  events: z
    .array(
      z.object({
        tripId: z.uuid(),
        passengerId: z.uuid(),
        boarded: z.boolean(),
        at: z.coerce.date(),
      }),
    )
    .max(500),
});

// Replays boarding taps queued while the phone was offline, in order. Setting a
// passenger to a state is naturally repeatable, so a resent batch does no harm.
conductorAppRouter.post("/sync", async (req, res) => {
  const { events } = syncSchema.parse(req.body);
  const conductorId = req.auth.userId;

  let applied = 0;
  for (const e of events) {
    const { count } = await prisma.passenger.updateMany({
      where: {
        id: e.passengerId,
        operatorId: req.operatorId,
        booking: { tripId: e.tripId, status: { in: ["CONFIRMED", "BOARDED"] }, trip: { conductorId } },
      },
      data: { boarded: e.boarded, boardedAt: e.boarded ? e.at : null, boardedById: e.boarded ? conductorId : null },
    });
    applied += count;
  }
  res.json({ received: events.length, applied });
});

conductorAppRouter.post("/trips/:id/end", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const trip = await ownTrip(id, req.auth.userId, req.operatorId);
  if (trip.status === "COMPLETED") {
    res.json(trip);
    return;
  }
  res.json(await prisma.trip.update({ where: { id }, data: { status: "COMPLETED" }, select: tripFields }));
});
