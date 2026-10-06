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
  const commissionEach = trip.fare.mul(agent.commissionPct).div(100).toDecimalPlaces(2);

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

    const created = [];
    for (const p of input.passengers) {
      const booking = await tx.booking.create({
        data: {
          operatorId,
          tripId: trip.id,
          tripSeatId: p.seatId,
          channelId: channel.id,
          agentId,
          source: input.source,
          pnr,
          fare: trip.fare,
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
          commission: { create: { operatorId, agentId, amount: commissionEach } },
        },
        select: { id: true, fare: true, tripSeat: { select: { seatNumber: true } }, passenger: { select: { name: true } } },
      });
      created.push(booking);
    }
    return created;
  });

  return {
    pnr,
    totalFare: trip.fare.mul(bookings.length).toFixed(2),
    commission: commissionEach.mul(bookings.length).toFixed(2),
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
