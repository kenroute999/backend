import { Router, type Request } from "express";
import { rateLimit } from "express-rate-limit";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { config } from "../../core/config";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

// Live bus tracking. The conductor's phone reports where the bus is; a passenger who
// knows the PNR on their ticket can watch it on a map. Nobody signs in here: a passenger
// gets a short-lived link for one trip, and the phone a key that can only report one trip.

const HOUR_MS = 3_600_000;
/** Positions are taken, and shown, only around the journey: never the conductor's day off. */
const OPENS_BEFORE_MS = HOUR_MS;
const CLOSES_AFTER_MS = 6 * HOUR_MS;
const LINK_TTL_S = 24 * 3600;

const tripFields = {
  id: true,
  operatorId: true,
  conductorId: true,
  status: true,
  departureAt: true,
  arrivalAt: true,
  bus: { select: { registrationNo: true, name: true } },
  route: { select: { origin: true, destination: true } },
} as const;

type TrackedTrip = {
  id: string;
  status: string;
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
    now >= trip.departureAt.getTime() - OPENS_BEFORE_MS &&
    now <= trip.arrivalAt.getTime() + CLOSES_AFTER_MS
  );
}

// ---------------------------------------------------------------- tokens

// Signed with the server's key, but never accepted as a sign-in: they carry no account.
const linkClaims = z.object({ kind: z.literal("track"), tripId: z.uuid() });
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

async function view(trip: TrackedTrip) {
  const location = isLive(trip)
    ? await prisma.tripLocation.findFirst({
        where: { tripId: trip.id },
        orderBy: { recordedAt: "desc" },
        select: { latitude: true, longitude: true, accuracy: true, speed: true, heading: true, recordedAt: true },
      })
    : null;
  return {
    trip: {
      status: trip.status,
      origin: trip.route.origin,
      destination: trip.route.destination,
      departureAt: trip.departureAt,
      arrivalAt: trip.arrivalAt,
      bus: trip.bus,
    },
    location,
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

// Only the PNR opens a trip. A mobile number is known to too many people to be a key
// to where someone is travelling.
const lookupInput = z.strictObject({
  pnr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,12}$/, "Enter the PNR printed on your ticket"),
});

trackingRouter.post("/lookup", limitLookups, async (req, res) => {
  const { pnr } = lookupInput.parse(req.body);
  const booking = await prisma.booking.findFirst({
    where: { pnr, status: { in: ["CONFIRMED", "BOARDED", "COMPLETED"] } },
    orderBy: { createdAt: "desc" },
    select: { trip: { select: tripFields } },
  });
  if (!booking) throw new AppError(404, "NOT_FOUND", "No ticket found for this PNR");
  res.json({
    token: sign({ kind: "track", tripId: booking.trip.id }, LINK_TTL_S),
    expiresInSeconds: LINK_TTL_S,
    ...(await view(booking.trip)),
  });
});

trackingRouter.get("/location", async (req, res) => {
  const { tripId } = bearer(req, linkClaims);
  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: tripFields });
  if (!trip) throw new AppError(404, "NOT_FOUND", "Trip not found");
  res.json(await view(trip));
});

// The phone's background GPS reports here with its trip key.
trackingRouter.post("/fix", async (req, res) => {
  const { tripId, conductorId } = bearer(req, keyClaims);
  res.status(201).json(await saveFix(tripId, conductorId, req.body));
});
