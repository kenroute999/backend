import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { mobile as mobileInput } from "../../core/accounts";
import { config } from "../../core/config";
import { phoneHash } from "../../core/crypto";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";
import { distanceKm, findPlace } from "./places";

// Live bus tracking. The conductor's phone reports where the bus is; a passenger who
// knows the PNR on their ticket can watch it on a map. Nobody signs in here: a passenger
// gets a short-lived link for one trip, and the phone a key that can only report one trip.

const HOUR_MS = 3_600_000;
/**
 * Positions are taken, and shown, only around the journey: never the conductor's day off.
 * Tracking opens when the conductor starts the trip, or by itself an hour before departure.
 */
const OPENS_BEFORE_MS = HOUR_MS;
/** A conductor may start the trip this long before departure, not earlier. */
export const START_BEFORE_MS = 2 * HOUR_MS;
const CLOSES_AFTER_MS = 6 * HOUR_MS;
const LINK_TTL_S = 24 * 3600;

const tripFields = {
  id: true,
  operatorId: true,
  conductorId: true,
  status: true,
  startedAt: true,
  departureAt: true,
  arrivalAt: true,
  bus: { select: { registrationNo: true, name: true } },
  route: { select: { origin: true, destination: true } },
} as const;

type TrackedTrip = {
  id: string;
  status: string;
  startedAt: Date | null;
  departureAt: Date;
  arrivalAt: Date;
  bus: { registrationNo: string; name: string | null };
  route: { origin: string; destination: string };
};

function isLive(trip: TrackedTrip): boolean {
  const now = Date.now();
  return (
    trip.status !== "COMPLETED" &&
    trip.status !== "CANCELLED" &&
    (trip.startedAt !== null || now >= trip.departureAt.getTime() - OPENS_BEFORE_MS) &&
    now <= trip.arrivalAt.getTime() + CLOSES_AFTER_MS
  );
}

// ---------------------------------------------------------------- tokens

// Signed with the server's key, but never accepted as a sign-in: they carry no account.
const linkClaims = z.object({ kind: z.literal("track"), tripId: z.uuid(), bookingId: z.uuid().optional() });
const keyClaims = z.object({ kind: z.literal("gps"), tripId: z.uuid(), conductorId: z.uuid() });

const sign = (claims: object, expiresIn: number) =>
  jwt.sign(claims, config.jwtAccessSecret, { expiresIn, algorithm: "HS256" });

function bearer<T>(req: Request, claims: z.ZodType<T>): T {
  const expired = new AppError(401, "UNAUTHENTICATED", "This tracking link has expired");
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) throw expired;
  try {
    return claims.parse(jwt.verify(header.slice(7), config.jwtAccessSecret, { algorithms: ["HS256"] }));
  } catch {
    throw expired;
  }
}

/** The key the conductor's phone uses to report positions for one trip while the app is closed. */
export const gpsKeyFor = (tripId: string, conductorId: string) => ({
  token: sign({ kind: "gps", tripId, conductorId }, LINK_TTL_S),
  expiresInSeconds: LINK_TTL_S,
});

// ---------------------------------------------------------------- positions

const fixInput = z.strictObject({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullish(),
  speed: z.number().min(0).max(100).nullish(), // metres per second
  heading: z.number().min(0).max(360).nullish(),
  at: z.coerce.date().optional(),
});

/** Stores one position for a trip the caller is already known to conduct. */
export async function saveFix(tripId: string, conductorId: string, body: unknown) {
  const { at, ...fix } = fixInput.parse(body);
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, conductorId, conductor: { isActive: true } },
    select: tripFields,
  });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Trip not found");
  if (!isLive(trip)) throw new AppError(409, "NOT_TRACKING", "This trip is not being tracked now");

  // A phone with a wrong clock must not put the bus in the future, or bring back an old position.
  const now = Date.now();
  const recordedAt = at && at.getTime() <= now && at.getTime() > now - HOUR_MS ? at : new Date(now);
  await prisma.tripLocation.create({
    data: {
      operatorId: trip.operatorId,
      tripId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: fix.accuracy ?? null,
      speed: fix.speed ?? null,
      heading: fix.heading ?? null,
      recordedAt,
    },
  });
  return { saved: true };
}

/**
 * The passenger's own stop: where they board, or once on the bus, where they get down;
 * with how far the bus is from it.
 *
 * ponytail: the time is straight-line distance plus 30% for roads, at the bus's current
 * speed kept between 20 and 70 km/h. Good to a few minutes in town, rough on a highway.
 * Use a road-routing service if passengers start relying on the minute.
 */
async function stopFor(trip: TrackedTrip, bookingId: string | undefined, bus: { latitude: number; longitude: number; speed: number | null } | null) {
  if (!bookingId) return null;
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, tripId: trip.id },
    select: { boardingPoint: true, droppingPoint: true, passenger: { select: { boarded: true } } },
  });
  if (!booking) return null;
  const onBoard = booking.passenger?.boarded === true;
  const name = onBoard ? booking.droppingPoint : booking.boardingPoint;
  if (!name) return null;
  const place = await findPlace(name, onBoard ? trip.route.destination : trip.route.origin);
  if (!place) return null;

  const km = bus ? distanceKm(bus, place) * 1.3 : null;
  const kmh = Math.min(70, Math.max(20, (bus?.speed ?? 0) * 3.6 || 35));
  return {
    kind: onBoard ? ("DROPPING" as const) : ("BOARDING" as const),
    name,
    ...place,
    distanceKm: km === null ? null : Math.round(km * 10) / 10,
    etaMinutes: km === null ? null : Math.max(1, Math.round((km / kmh) * 60)),
  };
}

async function view(trip: TrackedTrip, bookingId?: string) {
  const location = isLive(trip)
    ? await prisma.tripLocation.findFirst({
        where: { tripId: trip.id },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, accuracy: true, speed: true, heading: true, recordedAt: true },
      })
    : null;
  return {
    trip: {
      status: trip.status === "SCHEDULED" && trip.startedAt ? "IN_PROGRESS" : trip.status,
      origin: trip.route.origin,
      destination: trip.route.destination,
      departureAt: trip.departureAt,
      arrivalAt: trip.arrivalAt,
      bus: trip.bus,
    },
    location,
    stop: await stopFor(trip, bookingId, location),
  };
}

// ---------------------------------------------------------------- routes

export const trackingRouter = Router();

// A PNR has about a billion combinations; this keeps anyone from trying them in bulk.
const limitLookups = rateLimit({
  windowMs: 60_000,
  limit: 10,
  legacyHeaders: false,
  skip: () => config.nodeEnv === "test",
  handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many tries. Wait a minute and try again.")),
});

// A ticket can be opened by the PNR printed on it, or by the mobile number it was
// booked with. Both are matched against the booking; the mobile lookup hashes the
// number and matches it against the passenger's phoneHash, so nothing is decrypted.
const lookupInput = z.union([
  z.strictObject({
    pnr: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{6,12}$/, "Enter the PNR printed on your ticket"),
  }),
  z.strictObject({ mobile: mobileInput }),
]);

trackingRouter.post("/lookup", limitLookups, async (req, res) => {
  const input = lookupInput.parse(req.body);
  const booking = await prisma.booking.findFirst({
    where: {
      status: { in: ["CONFIRMED", "BOARDED", "COMPLETED"] },
      ...("pnr" in input ? { pnr: input.pnr } : { passenger: { phoneHash: phoneHash(input.mobile) } }),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, trip: { select: tripFields } },
  });
  if (!booking) throw new AppError(404, "NOT_FOUND", "No ticket found for this PNR or mobile number");
  res.json({
    token: sign({ kind: "track", tripId: booking.trip.id, bookingId: booking.id }, LINK_TTL_S),
    expiresInSeconds: LINK_TTL_S,
    ...(await view(booking.trip, booking.id)),
  });
});

trackingRouter.get("/location", async (req, res) => {
  const { tripId, bookingId } = bearer(req, linkClaims);
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: tripFields });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Trip not found");
  res.json(await view(trip, bookingId));
});

// The phone's background GPS reports here with its trip key.
trackingRouter.post("/fix", async (req, res) => {
  const { tripId, conductorId } = bearer(req, keyClaims);
  res.status(201).json(await saveFix(tripId, conductorId, req.body));
});
