import cors from "cors";
import express from "express";
import { requireAuth, requireRole } from "./core/auth";
import { config } from "./core/config";
import { errorHandler, notFound } from "./core/errors";
import { agentsRouter } from "./modules/agents/routes";
import { authRouter, me } from "./modules/auth/routes";
import { bookingRouter } from "./modules/booking/routes";
import { busesRouter } from "./modules/buses/routes";
import { conductorAppRouter } from "./modules/conductor-app/routes";
import { conductorsRouter } from "./modules/conductors/routes";
import { driversRouter } from "./modules/drivers/routes";
import { routesRouter } from "./modules/routes/routes";
import { tripsRouter } from "./modules/trips/routes";

export const app = express();

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json({ limit: "100kb" }));

const api = express.Router();
api.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
api.use("/auth", authRouter);
api.get("/me", requireAuth, me);

// Everything below is the owner's back office.
const owner = [requireAuth, requireRole("OWNER")];
api.use("/agents", owner, agentsRouter);
api.use("/drivers", owner, driversRouter);
api.use("/conductors", owner, conductorsRouter);
api.use("/buses", owner, busesRouter);
api.use("/routes", owner, routesRouter);
api.use("/trips", owner, tripsRouter);

// The agent's booking desk.
api.use("/booking", requireAuth, requireRole("AGENT"), bookingRouter);

// The conductor's phone app.
api.use("/conductor", requireAuth, requireRole("CONDUCTOR"), conductorAppRouter);

app.use("/api/v1", api);
app.use(notFound);
app.use(errorHandler);
