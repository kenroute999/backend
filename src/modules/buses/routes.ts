import { Router } from "express";
import { z } from "zod";
import { idParam, isInUseError, isPrismaError } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

const busInput = z.strictObject({
  registrationNo: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9 -]{4,15}$/, "Enter a valid bus number"),
  name: z.string().trim().min(1).max(60),
  seating: z.enum(["SLEEPER", "SEATER", "SEATER_SLEEPER"]),
  isAc: z.boolean(),
  /** Used to pick the bus's seat layout. */
  seats: z.number().int().min(1).max(80),
  status: z.enum(["ACTIVE", "MAINTENANCE", "INACTIVE"]).default("ACTIVE"),
});

const busFields = {
  id: true,
  registrationNo: true,
  name: true,
  isAc: true,
  seating: true,
  status: true,
  seatLayout: { select: { id: true, name: true, totalSeats: true } },
} as const;

type Row = {
  seatLayout: { id: string; name: string; totalSeats: number };
} & Record<string, unknown>;
const present = ({ seatLayout, ...bus }: Row) => ({ ...bus, seats: seatLayout.totalSeats, seatLayout });

/** Placeholder grid, four across on one deck, until the bus is given a designed layout. */
function gridSeats(count: number, type: string) {
  return Array.from({ length: count }, (_, i) => ({
    number: String(i + 1),
    deck: "LOWER",
    row: Math.floor(i / 4),
    col: i % 4,
    type,
    ladiesOnly: false,
  }));
}

/** Buses of the same kind and size share one layout. */
export async function layoutFor(operatorId: string, seating: string, seats: number) {
  const name = `${seating} ${seats}`;
  return (
    (await prisma.seatLayout.findFirst({ where: { operatorId, name } })) ??
    (await prisma.seatLayout.create({
      data: { operatorId, name, totalSeats: seats, seats: gridSeats(seats, seating === "SEATER" ? "SEATER" : "SLEEPER") },
    }))
  );
}

const hasUpcomingTrips = (busId: string) =>
  prisma.trip.findFirst({
    where: { busId, status: { in: ["SCHEDULED", "BOARDING", "IN_PROGRESS"] }, arrivalAt: { gte: new Date() } },
    select: { id: true },
  });

const DUPLICATE = "A bus with this number already exists";

export const busesRouter = Router();

busesRouter.get("/", async (req, res) => {
  const rows = await prisma.bus.findMany({
    where: { operatorId: req.operatorId },
    select: busFields,
    orderBy: { registrationNo: "asc" },
  });
  res.json({ items: rows.map(present), total: rows.length });
});

busesRouter.post("/", async (req, res) => {
  const { seats, ...body } = busInput.parse(req.body);
  const operatorId = req.operatorId;
  const layout = await layoutFor(operatorId, body.seating, seats);
  try {
    const bus = await prisma.bus.create({ data: { ...body, operatorId, seatLayoutId: layout.id }, select: busFields });
    res.status(201).json(present(bus));
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", DUPLICATE);
    throw err;
  }
});

busesRouter.patch("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { seats, ...body } = busInput.partial().parse(req.body);
  const operatorId = req.operatorId;

  const existing = await prisma.bus.findFirst({ where: { id, operatorId }, select: busFields });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Bus not found");

  const seating = body.seating ?? existing.seating;
  const seatCount = seats ?? existing.seatLayout.totalSeats;
  const layoutChanges = seating !== existing.seating || seatCount !== existing.seatLayout.totalSeats;
  const goesOffRoad = body.status !== undefined && body.status !== "ACTIVE" && existing.status === "ACTIVE";
  // Seats already on sale were generated from the old layout, and passengers may hold them.
  if ((layoutChanges || goesOffRoad) && (await hasUpcomingTrips(id))) {
    throw new AppError(409, "CONFLICT", "This bus has upcoming trips. Finish or cancel them first.");
  }

  try {
    const bus = await prisma.bus.update({
      where: { id },
      data: {
        ...(body.registrationNo !== undefined && { registrationNo: body.registrationNo }),
        ...(body.name !== undefined && { name: body.name }),
        ...(body.isAc !== undefined && { isAc: body.isAc }),
        ...(body.status !== undefined && { status: body.status }),
        ...(layoutChanges && { seating, seatLayoutId: (await layoutFor(operatorId, seating, seatCount)).id }),
      },
      select: busFields,
    });
    res.json(present(bus));
  } catch (err) {
    if (isPrismaError(err, "P2002")) throw new AppError(409, "CONFLICT", DUPLICATE);
    throw err;
  }
});

busesRouter.delete("/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const existing = await prisma.bus.findFirst({ where: { id, operatorId: req.operatorId }, select: { id: true } });
  if (!existing) throw new AppError(404, "NOT_FOUND", "Bus not found");
  try {
    await prisma.bus.delete({ where: { id } });
  } catch (err) {
    // Trips, past or future, refer to it: history must be kept.
    if (isInUseError(err)) {
      throw new AppError(409, "CONFLICT", "This bus has trips. Set it to Inactive instead.");
    }
    throw err;
  }
  res.status(204).end();
});
