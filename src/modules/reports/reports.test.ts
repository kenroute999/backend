import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";

const HOUR = 3_600_000;
let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);

const person = (seatId: string) => ({
  seatId,
  name: "Ramesh Kumar",
  age: 30,
  gender: "MALE",
  phone: "9876543210",
  idProofType: "AADHAAR",
  idProofNumber: "123456789012",
});

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("reports summary", () => {
  it("adds up real bookings: revenue leaves out cancelled tickets, and every breakdown agrees", async () => {
    const bus = await owner()
      .post("/api/v1/buses")
      .send({ registrationNo: "TS 09 CD 5678", name: "Scania", seating: "SEATER", isAc: true })
      .expect(201);
    const trip = await owner()
      .post("/api/v1/schedules")
      .send({
        origin: "Hyderabad",
        destination: "Vijayawada",
        busId: bus.body.id,
        departureAt: new Date(Date.now() + 2 * HOUR).toISOString(),
        arrivalAt: new Date(Date.now() + 7 * HOUR).toISOString(),
        fares: { seater: 500 },
      })
      .expect(201);
    const seats = await prisma.tripSeat.findMany({ where: { tripId: trip.body.id }, take: 3 });
    const agent = await prisma.agent.create({
      data: { operatorId: ids.operatorId, name: "Anil", phone: "9988776655", email: "anil@example.com", passwordHash: "x", agentCode: "AGT1", commissionPct: 10 },
    });
    const desk = as("AGENT", agent.id, ids.operatorId);
    const order = (seatIds: string[], source = "AGENT") => ({
      tripId: trip.body.id,
      source,
      boardingPoint: "Ameerpet",
      droppingPoint: "Benz Circle",
      paymentMode: "CASH",
      passengers: seatIds.map(person),
    });
    const two = await desk.post("/api/v1/booking/bookings").send(order([seats[0]!.id, seats[1]!.id])).expect(201);
    await desk.post("/api/v1/booking/bookings").send(order([seats[2]!.id], "COUNTER")).expect(201);
    await desk.post(`/api/v1/booking/bookings/${two.body.bookings[0].id}/cancel`).expect(200);

    const res = await owner().get("/api/v1/reports/summary").expect(200);
    expect(res.body.range.days).toBe(7);
    expect(res.body.totals).toMatchObject({ bookings: 2, cancelled: 1, revenue: 1000, averageFare: 500, commission: 100, trips: 1 });
    expect(res.body.today).toEqual({ bookings: 2, revenue: 1000 });
    expect(res.body.fleet).toMatchObject({ activeBuses: 1, activeRoutes: 1, upcomingTrips: 1, seatsSold: 2, seatsAvailable: 43 });

    expect(res.body.daily).toHaveLength(7);
    expect(res.body.daily.at(-1)).toMatchObject({ bookings: 2, revenue: 1000, cancelled: 1 });
    expect(Math.max(...res.body.daily.map((d: { occupancyPct: number }) => d.occupancyPct))).toBe(4.4);
    const source = Object.fromEntries(res.body.bySource.map((s: { source: string; bookings: number }) => [s.source, s.bookings]));
    expect(source).toEqual({ redBus: 0, AbhiBus: 0, Website: 0, Agent: 1, Counter: 1 });
    expect(res.body.byRoute).toEqual([
      { route: "Hyderabad → Vijayawada", bookings: 2, revenue: 1000, trips: 1, occupancyPct: 4.4 },
    ]);
    expect(res.body.byBus[0]).toMatchObject({ bus: "TS 09 CD 5678", bookings: 2, revenue: 1000 });
    expect(res.body.byAgent).toEqual([{ bookings: 2, revenue: 1000, name: "Anil", code: "AGT1", commission: 100 }]);
    expect(res.body.recent).toHaveLength(3);
    expect(JSON.stringify(res.body)).not.toMatch(/9876543210|phone/);
  });

  it("is empty but well-formed for a new operator, takes a date range, and is owner-only", async () => {
    const res = await owner().get("/api/v1/reports/summary?from=2026-01-01&to=2026-01-31").expect(200);
    expect(res.body.range).toEqual({ from: "2026-01-01", to: "2026-01-31", days: 31 });
    expect(res.body.totals).toMatchObject({ bookings: 0, revenue: 0, occupancyPct: 0 });
    expect(res.body.daily).toHaveLength(31);
    expect(res.body.byRoute).toEqual([]);

    await owner().get("/api/v1/reports/summary?from=2026-02-01&to=2026-01-01").expect(400);
    await owner().get("/api/v1/reports/summary?from=yesterday").expect(400);
    await as("AGENT", ids.userId, ids.operatorId).get("/api/v1/reports/summary").expect(403);
  });
});
