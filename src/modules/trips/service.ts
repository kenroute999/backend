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

export interface NewTrip {
  busId: string;
  routeId: string;
  departureAt: Date;
  arrivalAt: Date;
  /** Defaults to the route's base fare. */
  fare?: number;
  conductorId?: string;
  driverId?: string;
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
  if (input.arrivalAt <= input.departureAt) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { arrivalAt: "Arrival must be after departure" });
  }

  // One bus cannot be on two trips at once.
  const overlap = await prisma.trip.findFirst({
    where: {
      operatorId,
      busId: bus.id,
      status: { not: "CANCELLED" },
      departureAt: { lt: input.arrivalAt },
      arrivalAt: { gt: input.departureAt },
    },
    select: { id: true },
  });
  if (overlap) throw new AppError(409, "CONFLICT", "This bus already has a trip at that time");

  const seats = layoutSeats.parse(bus.seatLayout.seats);
  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        operatorId,
        busId: bus.id,
        routeId: route.id,
        departureAt: input.departureAt,
        arrivalAt: input.arrivalAt,
        fare: input.fare ?? route.baseFare,
        ...(input.conductorId !== undefined && { conductorId: input.conductorId }),
        ...(input.driverId !== undefined && { driverId: input.driverId }),
      },
    });
    await tx.tripSeat.createMany({
      data: seats.map((s) => ({
        operatorId,
        tripId: trip.id,
        seatNumber: s.number,
        deck: s.deck,
        row: s.row,
        col: s.col,
        seatType: s.type,
      })),
    });
    return trip;
  });
}
