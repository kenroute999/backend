import { Router } from "express";
import { z } from "zod";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";

// Figures for the owner's Dashboard and Reports screens, all from saved bookings and trips.
//
// Rules used everywhere here:
//   - a booking belongs to the day it was sold (India time);
//   - revenue is the full fare of tickets that stand; cancelled and refunded ones count as cancelled, not as money.
export const reportsRouter = Router();

const DAY_MS = 86_400_000;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const rangeSchema = z.object({ from: day.optional(), to: day.optional() });

const istDay = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const startOf = (isoDay: string) => new Date(`${isoDay}T00:00:00+05:30`);

type Channel = "OWN_AGENT" | "REDBUS" | "ABHIBUS";
function sourceName(channel: Channel, source: string): string {
  if (channel === "REDBUS") return "redBus";
  if (channel === "ABHIBUS") return "AbhiBus";
  return source === "COUNTER" ? "Counter" : "Agent";
}
const SOURCES = ["redBus", "AbhiBus", "Website", "Agent", "Counter"];

interface Tally {
  bookings: number;
  revenue: number;
}
function add<K>(map: Map<K, Tally>, key: K, fare: number) {
  const t = map.get(key) ?? { bookings: 0, revenue: 0 };
  t.bookings += 1;
  t.revenue += fare;
  map.set(key, t);
}

reportsRouter.get("/summary", async (req, res) => {
  const q = rangeSchema.parse(req.query);
  const operatorId = req.operatorId;
  const now = new Date();
  const today = istDay(now);
  const to = q.to ?? today;
  const from = q.from ?? istDay(new Date(startOf(to).getTime() - 6 * DAY_MS));
  const start = startOf(from);
  const end = new Date(startOf(to).getTime() + DAY_MS);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
    throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { from: "Must be on or before the end date" });
  }
  const days = Math.round((end.getTime() - start.getTime()) / DAY_MS);
  if (days > 366) throw new AppError(400, "VALIDATION_FAILED", "Invalid input", { from: "Choose a range of one year or less" });

  // ponytail: rows are loaded and added up here, which is fine up to tens of thousands of
  // bookings in a range; move to SQL group-by (or nightly totals) when an operator outgrows that.
  const [sold, trips, activeBuses, activeRoutes, upcoming, seatsSoldAhead, activeTrips, recent, todayRows] = await Promise.all([
    prisma.booking.findMany({
      where: { operatorId, createdAt: { gte: start, lt: end } },
      select: {
        status: true,
        source: true,
        fare: true,
        createdAt: true,
        tripId: true,
        channel: { select: { type: true } },
        agent: { select: { id: true, name: true, agentCode: true } },
        commission: { select: { amount: true, status: true } },
        trip: {
          select: {
            route: { select: { origin: true, destination: true } },
            bus: { select: { registrationNo: true, name: true } },
          },
        },
      },
    }),
    prisma.trip.findMany({
      where: { operatorId, departureAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED", "MAINTENANCE"] } },
      select: {
        id: true,
        route: { select: { origin: true, destination: true } },
        bus: { select: { registrationNo: true } },
        _count: { select: { seats: true } },
      },
    }),
    prisma.bus.count({ where: { operatorId, status: "ACTIVE" } }),
    prisma.route.count({ where: { operatorId, isActive: true } }),
    prisma.trip.findMany({
      where: { operatorId, status: "SCHEDULED", departureAt: { gt: now } },
      select: { _count: { select: { seats: true } } },
    }),
    prisma.tripSeat.count({
      where: { operatorId, status: "BOOKED", trip: { status: "SCHEDULED", departureAt: { gt: now } } },
    }),
    prisma.trip.count({
      where: { operatorId, status: { in: ["SCHEDULED", "BOARDING", "IN_PROGRESS"] }, departureAt: { lte: now }, arrivalAt: { gt: now } },
    }),
    prisma.booking.findMany({
      where: { operatorId },
      select: {
        pnr: true,
        status: true,
        source: true,
        fare: true,
        createdAt: true,
        channel: { select: { type: true } },
        agent: { select: { name: true } },
        passenger: { select: { name: true } },
        tripSeat: { select: { seatNumber: true } },
        trip: { select: { route: { select: { origin: true, destination: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    prisma.booking.findMany({
      where: { operatorId, createdAt: { gte: startOf(today) }, status: { notIn: ["CANCELLED", "REFUNDED"] } },
      select: { fare: true },
    }),
  ]);

  const stands = (status: string) => status !== "CANCELLED" && status !== "REFUNDED";
  const standing = sold.filter((b) => stands(b.status));
  const revenue = standing.reduce((sum, b) => sum + Number(b.fare), 0);

  // --- per day, including days with no sales
  const perDay = new Map<string, Tally & { cancelled: number }>();
  for (let i = 0; i < days; i++) perDay.set(istDay(new Date(start.getTime() + i * DAY_MS)), { bookings: 0, revenue: 0, cancelled: 0 });
  for (const b of sold) {
    const t = perDay.get(istDay(b.createdAt));
    if (!t) continue;
    if (stands(b.status)) {
      t.bookings += 1;
      t.revenue += Number(b.fare);
    } else t.cancelled += 1;
  }

  // --- by source, route, bus and agent
  const bySource = new Map<string, Tally>(SOURCES.map((s) => [s, { bookings: 0, revenue: 0 }]));
  const byRoute = new Map<string, Tally>();
  const byBus = new Map<string, Tally & { name: string }>();
  const byAgent = new Map<string, Tally & { name: string; code: string; commission: number }>();
  const soldOnTrip = new Map<string, number>();
  for (const b of standing) {
    const fare = Number(b.fare);
    add(bySource, sourceName(b.channel.type, b.source), fare);
    add(byRoute, `${b.trip.route.origin} → ${b.trip.route.destination}`, fare);
    soldOnTrip.set(b.tripId, (soldOnTrip.get(b.tripId) ?? 0) + 1);

    const bus = byBus.get(b.trip.bus.registrationNo) ?? { bookings: 0, revenue: 0, name: b.trip.bus.name ?? "" };
    bus.bookings += 1;
    bus.revenue += fare;
    byBus.set(b.trip.bus.registrationNo, bus);

    if (b.agent) {
      const a = byAgent.get(b.agent.id) ?? { bookings: 0, revenue: 0, name: b.agent.name, code: b.agent.agentCode, commission: 0 };
      a.bookings += 1;
      a.revenue += fare;
      if (b.commission && b.commission.status !== "VOID") a.commission += Number(b.commission.amount);
      byAgent.set(b.agent.id, a);
    }
  }

  // Seats offered, per route and per bus, on trips departing in the range.
  const offered = new Map<string, { trips: number; seats: number; sold: number }>();
  const offeredByBus = new Map<string, { trips: number; seats: number; sold: number }>();
  const offer = (map: typeof offered, key: string, seats: number, soldSeats: number) => {
    const o = map.get(key) ?? { trips: 0, seats: 0, sold: 0 };
    o.trips += 1;
    o.seats += seats;
    o.sold += soldSeats;
    map.set(key, o);
  };
  for (const t of trips) {
    const soldSeats = soldOnTrip.get(t.id) ?? 0;
    offer(offered, `${t.route.origin} → ${t.route.destination}`, t._count.seats, soldSeats);
    offer(offeredByBus, t.bus.registrationNo, t._count.seats, soldSeats);
  }
  const pct = (part: number, whole: number) => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);
  const byRevenue = <T extends Tally>(a: T, b: T) => b.revenue - a.revenue;

  const seatsAhead = upcoming.reduce((sum, t) => sum + t._count.seats, 0);
  const seatsInRange = trips.reduce((sum, t) => sum + t._count.seats, 0);
  const soldInRange = trips.reduce((sum, t) => sum + (soldOnTrip.get(t.id) ?? 0), 0);

  res.json({
    range: { from, to, days },
    totals: {
      bookings: standing.length,
      cancelled: sold.length - standing.length,
      revenue,
      averageFare: standing.length === 0 ? 0 : Math.round(revenue / standing.length),
      commission: [...byAgent.values()].reduce((sum, a) => sum + a.commission, 0),
      trips: trips.length,
      occupancyPct: pct(soldInRange, seatsInRange),
    },
    today: { bookings: todayRows.length, revenue: todayRows.reduce((sum, b) => sum + Number(b.fare), 0) },
    fleet: {
      activeBuses,
      activeRoutes,
      upcomingTrips: upcoming.length,
      activeTrips,
      seatsAvailable: seatsAhead - seatsSoldAhead,
      seatsSold: seatsSoldAhead,
      occupancyPct: pct(seatsSoldAhead, seatsAhead),
    },
    daily: [...perDay].map(([date, t]) => ({ date, ...t })),
    bySource: [...bySource].map(([source, t]) => ({ source, ...t })),
    byRoute: [...byRoute]
      .map(([route, t]) => {
        const o = offered.get(route);
        return { route, ...t, trips: o?.trips ?? 0, occupancyPct: pct(o?.sold ?? 0, o?.seats ?? 0) };
      })
      .sort(byRevenue),
    byBus: [...byBus]
      .map(([bus, t]) => {
        const o = offeredByBus.get(bus);
        return { bus, ...t, trips: o?.trips ?? 0, occupancyPct: pct(o?.sold ?? 0, o?.seats ?? 0) };
      })
      .sort(byRevenue),
    byAgent: [...byAgent.values()].sort(byRevenue),
    recent: recent.map((b) => ({
      pnr: b.pnr,
      seat: b.tripSeat.seatNumber,
      status: b.status,
      source: sourceName(b.channel.type, b.source),
      fare: Number(b.fare),
      createdAt: b.createdAt,
      passenger: b.passenger?.name ?? "",
      agent: b.agent?.name ?? "",
      route: `${b.trip.route.origin} → ${b.trip.route.destination}`,
    })),
  });
});
