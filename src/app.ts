import cors from "cors";
import express from "express";
import { config } from "./core/config";
import { devTenant } from "./core/dev-tenant";
import { errorHandler, notFound } from "./core/errors";
import { agentsRouter } from "./modules/agents/routes";
import { busesRouter } from "./modules/buses/routes";
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
api.use("/agents", devTenant, agentsRouter);
api.use("/drivers", devTenant, driversRouter);
api.use("/conductors", devTenant, conductorsRouter);
api.use("/buses", devTenant, busesRouter);
api.use("/routes", devTenant, routesRouter);
api.use("/trips", devTenant, tripsRouter);

app.use("/api/v1", api);
app.use(notFound);
app.use(errorHandler);
