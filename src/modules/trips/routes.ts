import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../core/db";

const listSchema = z.object({
  busId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// Read-only: upcoming trips, used to assign conductors and drivers.
export const tripsRouter = Router();

tripsRouter.get("/", async (req, res) => {
  const q = listSchema.parse(req.query);
  const items = await prisma.trip.findMany({
    where: {
      operatorId: req.operatorId,
      status: "SCHEDULED",
      departureAt: { gte: new Date() },
      ...(q.busId && { busId: q.busId }),
    },
    select: {
      id: true,
      departureAt: true,
      arrivalAt: true,
      bus: { select: { id: true, registrationNo: true, name: true } },
      route: { select: { id: true, origin: true, destination: true } },
      conductor: { select: { id: true, name: true } },
      driver: { select: { id: true, name: true } },
    },
    orderBy: { departureAt: "asc" },
    take: q.limit,
  });
  res.json({ items, total: items.length });
});
