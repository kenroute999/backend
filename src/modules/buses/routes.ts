import { Router } from "express";
import { prisma } from "../../core/db";

// Read-only for now: feeds the bus picker. Create, edit and delete come with the Buses screen.
export const busesRouter = Router();

busesRouter.get("/", async (req, res) => {
  const items = await prisma.bus.findMany({
    where: { operatorId: req.operatorId },
    select: { id: true, registrationNo: true, name: true, isAc: true, seating: true, status: true },
    orderBy: { registrationNo: "asc" },
  });
  res.json({ items, total: items.length });
});
