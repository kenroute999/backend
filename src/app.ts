import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { requireActive, requireAuth, requireRole } from "./core/auth";
import { config } from "./core/config";
import { AppError, errorHandler, notFound } from "./core/errors";
import { agentsRouter } from "./modules/agents/routes";
import { authRouter, me } from "./modules/auth/routes";
import { bookingRouter } from "./modules/booking/routes";
import { ownerBookingsRouter } from "./modules/bookings/routes";
import { busesRouter } from "./modules/buses/routes";
import { conductorAppRouter } from "./modules/conductor-app/routes";
import { conductorsRouter } from "./modules/conductors/routes";
import { driversRouter } from "./modules/drivers/routes";
import { reportsRouter } from "./modules/reports/routes";
import { routesRouter } from "./modules/routes/routes";
import { schedulesRouter } from "./modules/schedules/routes";
import { supportRouter } from "./modules/support/routes";
import { trackingRouter } from "./modules/tracking/routes";
import { tripsRouter } from "./modules/trips/routes";

export const app = express();

app.disable("x-powered-by");
// Behind a load balancer the caller's address arrives in a header; say how many proxies
// to trust (1 on AWS behind one load balancer) so rate limits count the real caller.
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 0));

// This server only ever answers with JSON, so it can be strict with browsers.
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  // Answers hold passenger details: nothing may keep a copy.
  res.setHeader("Cache-Control", "no-store");
  if (config.nodeEnv === "production") res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  next();
});

app.use(cors({ origin: config.corsOrigins, credentials: true }));

// A ceiling on how fast one address may call the API, against scraping and floods.
// Sign-in has its own, much tighter limits.
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 600,
    legacyHeaders: false,
    skip: () => config.nodeEnv === "test",
    handler: (_req, _res, next) => next(new AppError(429, "RATE_LIMITED", "Too many requests. Slow down and try again.")),
  }),
);
app.use(express.json({ limit: "100kb" }));

const api = express.Router();
api.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});
api.use("/auth", authRouter);
api.get("/me", requireAuth, me);

// Everything below is the owner's back office.
const owner = [requireAuth, requireRole("OWNER"), requireActive];
api.use("/agents", owner, agentsRouter);
api.use("/drivers", owner, driversRouter);
api.use("/conductors", owner, conductorsRouter);
api.use("/buses", owner, busesRouter);
api.use("/routes", owner, routesRouter);
api.use("/trips", owner, tripsRouter);
api.use("/schedules", owner, schedulesRouter);
api.use("/bookings", owner, ownerBookingsRouter);
api.use("/reports", owner, reportsRouter);

// The agent's booking desk.
api.use("/booking", requireAuth, requireRole("AGENT"), requireActive, bookingRouter);
api.use("/support", requireAuth, requireRole("AGENT"), requireActive, supportRouter);

// The conductor's phone app.
api.use("/conductor", requireAuth, requireRole("CONDUCTOR"), requireActive, conductorAppRouter);

// Passengers following their bus, and the phone's background GPS: no sign-in, own tokens.
api.use("/tracking", trackingRouter);

app.use("/api/v1", api);
app.use(notFound);
app.use(errorHandler);
