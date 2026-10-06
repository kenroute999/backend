import { z } from "zod";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const layoutSeats = z.array(
  z.object({
    number: z.string(),
    deck: z.enum(["LOWER", "UPPER"]),
    row: z.number().int(),
    col: z.number().int(),
    type: z.string().default("SLEEPER"),
  }),
);

/** Fare per kind of seat, in rupees. A bus only uses the kinds it has. */
export const faresSchema = z.strictObject({
  seater: z.number().positive().max(100_000).optional(),
  singleBed: z.number().positive().max(100_000).optional(),
  doubleBed: z.number().positive().max(100_000).optional(),
});
export type Fares = z.infer<typeof faresSchema>;

/** Which fare applies to a seat of the given layout type. */
export function fareFor(seatType: string, fares: Fares, fallback: number): number {
  const kind = seatType.toUpperCase();
  if (kind.includes("SEATER") || kind === "SEAT") return fares.seater ?? fallback;
  if (kind.includes("DOUBLE")) return fares.doubleBed ?? fares.singleBed ?? fallback;
  return fares.singleBed ?? fallback;
}

export interface NewTrip {
  busId: string;
  routeId: string;
  departureAt: Date;
  arrivalAt: Date;
  /** Per seat kind. Kinds left out fall back to `fare`, then to the route's base fare. */
  fares?: Fares;
  fare?: number;
  conductorId?: string;
  driverId?: string;
}

/** One bus cannot be on two trips at once. */
export async function assertBusFree(
  operatorId: string,
  busId: string,
  departureAt: Date,
  arrivalAt: Date,
  exceptTripId?: string,
) {
  if (arrivalAt <= departureAt) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { arrivalAt: "Arrival must be after departure" });
  }
  const overlap = await prisma.trip.findFirst({
    where: {
      operatorId,
      busId,
      status: { notIn: ["CANCELLED", "MAINTENANCE"] },
      departureAt: { lt: arrivalAt },
      arrivalAt: { gt: departureAt },
      ...(exceptTripId && { NOT: { id: exceptTripId } }),
    },
    select: { id: true },
  });
  if (overlap) throw new AppError(409, "CONFLICT", "This bus already has a trip at that time");
}

/**
 * The only way a trip is created: the trip and one TripSeat per seat of the
 * bus's layout are written together, so a trip never exists without its seats.
 */
export async function createTripWithSeats(operatorId: string, input: NewTrip) {
  const [bus, route] = await Promise.all([
    prisma.bus.findFirst({ where: { id: input.busId, operatorId }, include: { seatLayout: true } }),
    prisma.route.findFirst({ where: { id: input.routeId, operatorId } }),
  ]);
  if (!bus) throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { busId: "Bus not found" });
  if (!route) throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { routeId: "Route not found" });
  await assertBusFree(operatorId, bus.id, input.departureAt, input.arrivalAt);

  const seats = layoutSeats.parse(bus.seatLayout.seats);
  const fares = input.fares ?? {};
  const fallback = input.fare ?? Number(route.baseFare);
  const priced = seats.map((s) => ({ ...s, fare: fareFor(s.type, fares, fallback) }));
  const lowest = priced.length > 0 ? Math.min(...priced.map((s) => s.fare)) : fallback;

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        operatorId,
        busId: bus.id,
        routeId: route.id,
        departureAt: input.departureAt,
        arrivalAt: input.arrivalAt,
        fare: lowest,
        ...(input.fares && { fares: input.fares }),
        ...(input.conductorId !== undefined && { conductorId: input.conductorId }),
        ...(input.driverId !== undefined && { driverId: input.driverId }),
      },
    });
    await tx.tripSeat.createMany({
      data: priced.map((s) => ({
        operatorId,
        tripId: trip.id,
        seatNumber: s.number,
        deck: s.deck,
        row: s.row,
        col: s.col,
        seatType: s.type,
        fare: s.fare,
      })),
    });
    return trip;
  });
}

/**
 * Brings upcoming trips in line with the current layout of their bus. Only trips on
 * which nothing has ever been booked are touched: their seats are replaced and
 * priced again. A trip with bookings keeps the seats its passengers hold.
 */
export async function rebuildUnsoldTripSeats(operatorId: string): Promise<number> {
  const trips = await prisma.trip.findMany({
    where: { operatorId, departureAt: { gt: new Date() }, bookings: { none: {} } },
    include: { bus: { include: { seatLayout: true } }, seats: { select: { seatNumber: true } } },
  });
  let rebuilt = 0;
  for (const trip of trips) {
    const layout = layoutSeats.parse(trip.bus.seatLayout.seats);
    const current = trip.seats.map((s) => s.seatNumber).sort().join(",");
    const wanted = layout.map((s) => s.number).sort().join(",");
    if (current === wanted) continue;

    const fares = (trip.fares ?? {}) as Fares;
    const fallback = Number(trip.fare);
    await prisma.$transaction([
      prisma.tripSeat.deleteMany({ where: { tripId: trip.id } }),
      prisma.tripSeat.createMany({
        data: layout.map((s) => ({
          operatorId,
          tripId: trip.id,
          seatNumber: s.number,
          deck: s.deck,
          row: s.row,
          col: s.col,
          seatType: s.type,
          fare: fareFor(s.type, fares, fallback),
        })),
      }),
    ]);
    rebuilt++;
  }
  return rebuilt;
}
