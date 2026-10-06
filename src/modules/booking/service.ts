import crypto from "node:crypto";
import { z } from "zod";
import { mobile, personName } from "../../core/accounts";
import { encrypt, phoneHash } from "../../core/crypto";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

export const ID_PROOF_TYPES = ["AADHAAR", "PAN", "DRIVING_LICENCE", "VOTER_ID", "PASSPORT"] as const;

const passenger = z.strictObject({
  seatId: z.uuid(),
  name: personName,
  age: z.number().int().min(1).max(120),
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  phone: mobile,
  idProofType: z.enum(ID_PROOF_TYPES),
  idProofNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 -]{5,20}$/, "Enter a valid ID number"),
});

export const bookingInput = z
  .strictObject({
    tripId: z.uuid(),
    source: z.enum(["AGENT", "COUNTER", "PHONE", "CORPORATE"]),
    boardingPoint: z.string().trim().min(1).max(80),
    droppingPoint: z.string().trim().min(1).max(80),
    paymentMode: z.enum(["CASH", "UPI"]),
    notes: z.string().trim().max(200).optional(),
    passengers: z.array(passenger).min(1).max(6),
  })
  .refine((b) => new Set(b.passengers.map((p) => p.seatId)).size === b.passengers.length, {
    message: "Each passenger needs a different seat",
    path: ["passengers"],
  });

export type BookingInput = z.infer<typeof bookingInput>;

// No 0/O or 1/I, so a code read out over the phone cannot be misheard.
const PNR_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newPnr(): string {
  return "KR" + Array.from(crypto.randomBytes(6), (b) => PNR_ALPHABET[b % PNR_ALPHABET.length]).join("");
}

/**
 * The only way an agent booking is created. Seats, bookings, passengers and
 * commission are written together or not at all.
 */
export async function createBooking(ctx: { operatorId: string; agentId: string }, input: BookingInput) {
  const { operatorId, agentId } = ctx;

  const [trip, agent] = await Promise.all([
    prisma.trip.findFirst({
      where: { id: input.tripId, operatorId, status: "SCHEDULED", departureAt: { gt: new Date() } },
      include: { route: true, bus: { select: { registrationNo: true, name: true } } },
    }),
    prisma.agent.findFirst({ where: { id: agentId, operatorId, isActive: true } }),
  ]);
  if (!trip) throw new AppError(404, "NOT_FOUND", "This trip is no longer open for booking");
  if (!agent) throw new AppError(403, "FORBIDDEN", "This agent account cannot book");

  const stops = (field: "boardingPoint" | "droppingPoint", allowed: string[]) => {
    if (allowed.length > 0 && !allowed.includes(input[field])) {
      throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { [field]: "Choose a stop on this route" });
    }
  };
  stops("boardingPoint", trip.route.boardingPoints);
  stops("droppingPoint", trip.route.droppingPoints);

  const seatIds = input.passengers.map((p) => p.seatId);
  const pnr = newPnr();

  const bookings = await prisma.$transaction(async (tx) => {
    // Claim the seats in one conditional update: if anyone else got there first, the
    // count comes up short and the whole booking is rolled back. A partial unique
    // index on active bookings per seat backs this up at the database level.
    const claimed = await tx.tripSeat.updateMany({
      where: { id: { in: seatIds }, tripId: trip.id, operatorId, status: "AVAILABLE" },
      data: { status: "BOOKED", heldUntil: null, heldById: null },
    });
    if (claimed.count !== seatIds.length) {
      throw new AppError(409, "SEAT_UNAVAILABLE", "One or more of these seats was just taken. Please choose again.");
    }

    const channel =
      (await tx.channel.findFirst({ where: { operatorId, type: "OWN_AGENT" } })) ??
      (await tx.channel.create({ data: { operatorId, type: "OWN_AGENT", status: "CONNECTED" } }));

    // Each seat has its own fare (sleeper and seater berths differ); the request never sets a price.
    const fareBySeat = new Map(
      (await tx.tripSeat.findMany({ where: { id: { in: seatIds } }, select: { id: true, fare: true } })).map((s) => [
        s.id,
        s.fare,
      ]),
    );

    const created = [];
    for (const p of input.passengers) {
      const fare = fareBySeat.get(p.seatId) ?? trip.fare;
      const commission = fare.mul(agent.commissionPct).div(100).toDecimalPlaces(2);
      const booking = await tx.booking.create({
        data: {
          operatorId,
          tripId: trip.id,
          tripSeatId: p.seatId,
          channelId: channel.id,
          agentId,
          source: input.source,
          pnr,
          fare,
          status: "CONFIRMED",
          boardingPoint: input.boardingPoint,
          droppingPoint: input.droppingPoint,
          paymentMode: input.paymentMode,
          ...(input.notes && { notes: input.notes }),
          passenger: {
            create: {
              operatorId,
              name: p.name,
              age: p.age,
              gender: p.gender,
              phoneEnc: encrypt(p.phone),
              phoneHash: phoneHash(p.phone),
              idProofType: p.idProofType,
              idProofEnc: encrypt(p.idProofNumber),
            },
          },
          commission: { create: { operatorId, agentId, amount: commission } },
        },
        select: {
          id: true,
          fare: true,
          tripSeat: { select: { seatNumber: true } },
          passenger: { select: { name: true } },
          commission: { select: { amount: true } },
        },
      });
      created.push(booking);
    }
    return created;
  });

  return {
    pnr,
    totalFare: bookings.reduce((sum, b) => sum.add(b.fare), trip.fare.mul(0)).toFixed(2),
    commission: bookings.reduce((sum, b) => sum.add(b.commission?.amount ?? 0), trip.fare.mul(0)).toFixed(2),
    boardingPoint: input.boardingPoint,
    droppingPoint: input.droppingPoint,
    trip: {
      id: trip.id,
      origin: trip.route.origin,
      destination: trip.route.destination,
      departureAt: trip.departureAt,
      arrivalAt: trip.arrivalAt,
      bus: trip.bus,
    },
    bookings: bookings.map((b) => ({
      id: b.id,
      seatNumber: b.tripSeat.seatNumber,
      fare: b.fare.toFixed(2),
      passengerName: b.passenger?.name ?? "",
    })),
  };
}

/**
 * Cancels a ticket before the bus leaves: the seat goes back on sale and the
 * commission for it is voided. Any refund is handled outside KenRoute.
 * Pass `agentId` to limit it to that agent's own tickets; the owner passes none.
 */
export async function cancelBooking(where: { id: string; operatorId: string; agentId?: string }) {
  const booking = await prisma.booking.findFirst({
    where,
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
      where: { id: where.id, status: { in: ["CONFIRMED", "CREATED"] } },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    if (count === 0) throw new AppError(409, "CONFLICT", "This ticket can no longer be cancelled");
    await tx.tripSeat.update({ where: { id: booking.tripSeatId }, data: { status: "AVAILABLE" } });
    await tx.commissionLedger.updateMany({ where: { bookingId: where.id, status: "PENDING" }, data: { status: "VOID" } });
  });
  return { id: where.id, status: "CANCELLED" as const };
}
