import { Router } from "express";
import { prisma } from "../../core/db";

// Read-only for now: feeds the route picker. Create, edit and delete come with the Routes screen.
export const routesRouter = Router();

routesRouter.get("/", async (req, res) => {
  const items = await prisma.route.findMany({
    where: { operatorId: req.operatorId },
    select: { id: true, origin: true, destination: true, baseFare: true, isActive: true },
    orderBy: [{ origin: "asc" }, { destination: "asc" }],
  });
  res.json({ items, total: items.length });
});
