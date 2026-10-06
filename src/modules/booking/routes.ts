import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../core/accounts";
import { decrypt } from "../../core/crypto";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";
import { bookingInput, createBooking } from "./service";

// The agent's booking desk: routes the owner created, trips on a date, seats, and the booking itself.
export const bookingRouter = Router();

bookingRouter.get("/routes", async (req, res) => {
  const items = await prisma.route.findMany({
    where: { operatorId: req.operatorId, isActive: true },
    select: { id: true, origin: true, destination: true, boardingPoints: true, droppingPoints: true },
    orderBy: [{ origin: "asc" }, { destination: "asc" }],
  });
  res.json({ items, total: items.length });
});

const tripQuery = z.object({
  routeId: z.uuid(),
  /** A calendar day in India. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  seating: z.enum(["SLEEPER", "SEATER", "SEATER_SLEEPER"]).optional(),
});

const tripFields = {
  id: true,
  departureAt: true,
  arrivalAt: true,
  fare: true,
  route: { select: { id: true, origin: true, destination: true, boardingPoints: true, droppingPoints: true } },
  bus: { select: { registrationNo: true, name: true, isAc: true, seating: true } },
} as const;

bookingRouter.get("/trips", async (req, res) => {
  const q = tripQuery.parse(req.query);
  const dayStart = new Date(`${q.date}T00:00:00+05:30`);
  if (Number.isNaN(dayStart.getTime())) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { date: "Not a real date" });
  }
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const now = new Date();

  const trips = await prisma.trip.findMany({
    where: {
      operatorId: req.operatorId,
      routeId: q.routeId,
      status: "SCHEDULED",
      // Buses that have already left cannot be booked.
      departureAt: { gte: dayStart > now ? dayStart : now, lt: dayEnd },
      ...(q.seating && { bus: { seating: q.seating } }),
    },
    select: { ...tripFields, _count: { select: { seats: true } } },
    orderBy: { departureAt: "asc" },
  });

  const free = await prisma.tripSeat.groupBy({
    by: ["tripId"],
    where: { tripId: { in: trips.map((t) => t.id) }, status: "AVAILABLE" },
    _count: true,
  });
  const freeByTrip = new Map(free.map((f) => [f.tripId, f._count]));

  const items = trips.map(({ _count, ...t }) => ({
    ...t,
    totalSeats: _count.seats,
    availableSeats: freeByTrip.get(t.id) ?? 0,
  }));
  res.json({ items, total: items.length });
});

bookingRouter.get("/trips/:id/seats", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const trip = await prisma.trip.findFirst({
    where: { id, operatorId: req.operatorId, status: "SCHEDULED" },
    select: tripFields,
  });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Trip not found");

  const seats = await prisma.tripSeat.findMany({
    where: { tripId: id },
    select: {
      id: true,
      seatNumber: true,
      deck: true,
      row: true,
      col: true,
      seatType: true,
      status: true,
      // Only the gender of the current occupant, for the seat colour. No names or phones.
      bookings: {
        where: { status: { in: ["CONFIRMED", "BOARDED", "COMPLETED"] } },
        select: { passenger: { select: { gender: true } } },
        take: 1,
      },
    },
    orderBy: [{ deck: "asc" }, { row: "asc" }, { col: "asc" }],
  });

  res.json({
    trip,
    seats: seats.map(({ bookings, ...s }) => ({ ...s, passengerGender: bookings[0]?.passenger?.gender ?? null })),
  });
});

// The agent's own bookings, newest first. Agents never see another agent's bookings.
// ponytail: latest 200 in one page; add paging and server-side filters when an agent outgrows that.
bookingRouter.get("/bookings", async (req, res) => {
  const rows = await prisma.booking.findMany({
    where: { operatorId: req.operatorId, agentId: req.auth.userId },
    select: {
      id: true,
      pnr: true,
      status: true,
      source: true,
      fare: true,
      paymentMode: true,
      boardingPoint: true,
      droppingPoint: true,
      createdAt: true,
      tripSeat: { select: { seatNumber: true } },
      trip: {
        select: {
          departureAt: true,
          arrivalAt: true,
          route: { select: { origin: true, destination: true } },
          bus: { select: { registrationNo: true, name: true } },
        },
      },
      passenger: { select: { name: true, age: true, gender: true, phoneEnc: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const items = rows.map(({ tripSeat, passenger, ...b }) => ({
    ...b,
    seatNumber: tripSeat.seatNumber,
    // The agent typed this number in, so they may see it again.
    passenger: passenger && {
      name: passenger.name,
      age: passenger.age,
      gender: passenger.gender,
      phone: decrypt(passenger.phoneEnc),
    },
  }));
  res.json({ items, total: items.length });
});

// An agent cancels one of their own tickets before the bus leaves. The seat goes back on
// sale and the commission for it is voided. Any refund is handled outside KenRoute.
bookingRouter.post("/bookings/:id/cancel", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const booking = await prisma.booking.findFirst({
    where: { id, operatorId: req.operatorId, agentId: req.auth.userId },
    select: { status: true, tripSeatId: true, trip: { select: { departureAt: true } } },
  });
  if (!booking) throw new AppError(404, "NOT_FOUND", "Ticket not found");
  if (booking.status === "CANCELLED" || booking.status === "REFUNDED") {
    throw new AppError(409, "CONFLICT", "This ticket is already cancelled");
  }
  if (booking.status !== "CONFIRMED" && booking.status !== "CREATED") {
    throw new AppError(409, "CONFLICT", "A boarded or completed ticket cannot be cancelled");
  }
  if (booking.trip.departureAt <= new Date()) {
    throw new AppError(409, "CONFLICT", "The bus has already left; this ticket can no longer be cancelled");
  }

  await prisma.$transaction(async (tx) => {
    // Conditional on the status, so a conductor boarding the passenger at the same moment wins or loses cleanly.
    const { count } = await tx.booking.updateMany({
      where: { id, status: { in: ["CONFIRMED", "CREATED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (count === 0) throw new AppError(409, "CONFLICT", "This ticket can no longer be cancelled");
    await tx.tripSeat.update({ where: { id: booking.tripSeatId }, data: { status: "AVAILABLE" } });
    await tx.commissionLedger.updateMany({ where: { bookingId: id, status: "PENDING" }, data: { status: "VOID" } });
  });
  res.json({ id, status: "CANCELLED" });
});

bookingRouter.post("/bookings", async (req, res) => {
  const input = bookingInput.parse(req.body);
  const ticket = await createBooking({ operatorId: req.operatorId, agentId: req.auth.userId }, input);
  res.status(201).json(ticket);
});
