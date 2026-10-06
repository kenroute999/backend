import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";

const HOUR = 3_600_000;
let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const bus = { registrationNo: "ts 09 ab 1234", name: "KenRoute Volvo", seating: "SEATER_SLEEPER", isAc: true, seats: 8 };

/** A bus whose layout has both seaters and sleepers, so fares by kind can be told apart. */
async function mixedBus() {
  const made = await owner().post("/api/v1/buses").send(bus).expect(201);
  await prisma.seatLayout.update({
    where: { id: made.body.seatLayout.id },
    data: {
      seats: [
        { number: "S1", deck: "LOWER", row: 0, col: 0, type: "SEATER" },
        { number: "S2", deck: "LOWER", row: 0, col: 1, type: "SEATER" },
        { number: "U1", deck: "UPPER", row: 0, col: 0, type: "SLEEPER" },
        { number: "U2", deck: "UPPER", row: 0, col: 2, type: "DOUBLE_SLEEPER" },
      ],
      totalSeats: 4,
    },
  });
  return made.body.id as string;
}

const schedule = (busId: string, over: Record<string, unknown> = {}) => ({
  origin: "Hyderabad",
  destination: "Bangalore",
  busId,
  departureAt: inHours(24),
  arrivalAt: inHours(33),
  boardingPoints: ["Ameerpet", "LB Nagar"],
  droppingPoints: ["Majestic"],
  fares: { seater: 800, singleBed: 1400, doubleBed: 950 },
  ...over,
});

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("buses", () => {
  it("creates, lists, updates and deletes a bus; blocks a duplicate number", async () => {
    const made = await owner().post("/api/v1/buses").send(bus).expect(201);
    expect(made.body).toMatchObject({ registrationNo: "TS 09 AB 1234", seating: "SEATER_SLEEPER", isAc: true, seats: 8, status: "ACTIVE" });
    await owner().post("/api/v1/buses").send(bus).expect(409);
    await owner().post("/api/v1/buses").send({ ...bus, registrationNo: "x" }).expect(400);

    const changed = await owner().patch(`/api/v1/buses/${made.body.id}`).send({ name: "Renamed", seats: 12, status: "MAINTENANCE" }).expect(200);
    expect(changed.body).toMatchObject({ name: "Renamed", seats: 12, status: "MAINTENANCE" });
    expect((await owner().get("/api/v1/buses").expect(200)).body.total).toBe(1);

    await owner().delete(`/api/v1/buses/${made.body.id}`).expect(204);
    expect((await owner().get("/api/v1/buses").expect(200)).body.total).toBe(0);
  });

  it("will not take a bus off the road or delete it while it has trips", async () => {
    const busId = await mixedBus();
    await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    await owner().patch(`/api/v1/buses/${busId}`).send({ status: "MAINTENANCE" }).expect(409);
    await owner().delete(`/api/v1/buses/${busId}`).expect(409);
  });
});

describe("schedules", () => {
  it("saving one creates the route and a trip whose seats are priced by kind, ready for agents", async () => {
    const busId = await mixedBus();
    const res = await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    expect(res.body).toMatchObject({
      status: "SCHEDULED",
      fare: "800",
      fares: { seater: 800, singleBed: 1400, doubleBed: 950 },
      route: { origin: "Hyderabad", destination: "Bangalore", boardingPoints: ["Ameerpet", "LB Nagar"] },
      bus: { registrationNo: "TS 09 AB 1234" },
      _count: { seats: 4, bookings: 0 },
    });
    const seats = await prisma.tripSeat.findMany({ where: { tripId: res.body.id }, orderBy: { seatNumber: "asc" } });
    expect(seats.map((s) => [s.seatNumber, s.fare.toFixed(0)])).toEqual([
      ["S1", "800"],
      ["S2", "800"],
      ["U1", "1400"],
      ["U2", "950"],
    ]);

    // An agent finds it and pays that seat's own fare.
    const agent = await prisma.agent.create({
      data: { operatorId: ids.operatorId, name: "Anil", phone: "9988776655", email: "anil@example.com", passwordHash: "x", agentCode: "AGT1", commissionPct: 10 },
    });
    const desk = as("AGENT", agent.id, ids.operatorId);
    const routes = await desk.get("/api/v1/booking/routes").expect(200);
    expect(routes.body.items).toHaveLength(1);
    const sleeper = seats.find((s) => s.seatNumber === "U1")!;
    const seater = seats.find((s) => s.seatNumber === "S1")!;
    const person = (seatId: string) => ({ seatId, name: "Ramesh Kumar", age: 30, gender: "MALE", phone: "9876543210", idProofType: "AADHAAR", idProofNumber: "123456789012" });
    const ticket = await desk
      .post("/api/v1/booking/bookings")
      .send({ tripId: res.body.id, source: "AGENT", boardingPoint: "Ameerpet", droppingPoint: "Majestic", paymentMode: "CASH", passengers: [person(sleeper.id), person(seater.id)] })
      .expect(201);
    expect(ticket.body).toMatchObject({ totalFare: "2200.00", commission: "220.00" });
  });

  it("reuses the route for a second trip, and refuses two trips at once for one bus", async () => {
    const busId = await mixedBus();
    await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    await owner().post("/api/v1/schedules").send(schedule(busId, { departureAt: inHours(26), arrivalAt: inHours(35) })).expect(409);
    await owner().post("/api/v1/schedules").send(schedule(busId, { origin: "hyderabad", departureAt: inHours(48), arrivalAt: inHours(57) })).expect(201);
    expect(await prisma.route.count()).toBe(1);
    expect((await owner().get("/api/v1/schedules").expect(200)).body.total).toBe(2);
    await owner().post("/api/v1/schedules").send(schedule(busId, { destination: "Hyderabad" })).expect(400);
  });

  it("edits times, fares, stops and status; re-prices only unsold seats", async () => {
    const busId = await mixedBus();
    const made = await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    const url = `/api/v1/schedules/${made.body.id}`;
    const seat = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: made.body.id, seatNumber: "S1" } });
    await prisma.tripSeat.update({ where: { id: seat.id }, data: { status: "BOOKED" } });

    const res = await owner()
      .patch(url)
      .send({ departureAt: inHours(25), arrivalAt: inHours(34), fares: { seater: 900, singleBed: 1500, doubleBed: 1000 }, droppingPoints: ["Majestic", "Silk Board"] })
      .expect(200);
    expect(res.body).toMatchObject({ fare: "900", route: { droppingPoints: ["Majestic", "Silk Board"] } });
    const fares = Object.fromEntries((await prisma.tripSeat.findMany({ where: { tripId: made.body.id } })).map((s) => [s.seatNumber, s.fare.toFixed(0)]));
    expect(fares).toEqual({ S1: "800", S2: "900", U1: "1500", U2: "1000" });

    expect((await owner().patch(url).send({ status: "MAINTENANCE" }).expect(200)).body.status).toBe("MAINTENANCE");
    expect((await owner().patch(url).send({ status: "INACTIVE" }).expect(200)).body.status).toBe("CANCELLED");
  });

  it("protects sold tickets: no bus change, no going off sale, no delete", async () => {
    const busId = await mixedBus();
    const made = await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    const url = `/api/v1/schedules/${made.body.id}`;
    const seat = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: made.body.id } });
    const channel = await prisma.channel.create({ data: { operatorId: ids.operatorId, type: "OWN_AGENT" } });
    await prisma.booking.create({
      data: { operatorId: ids.operatorId, tripId: made.body.id, tripSeatId: seat.id, channelId: channel.id, source: "COUNTER", pnr: "KRTEST01", fare: 800 },
    });

    await owner().patch(url).send({ status: "INACTIVE" }).expect(409);
    await owner().patch(url).send({ destination: "Chennai" }).expect(409);
    await owner().delete(url).expect(409);
    // Times can still move.
    await owner().patch(url).send({ departureAt: inHours(25), arrivalAt: inHours(34) }).expect(200);
  });

  it("deletes an unsold trip, and never touches another operator's", async () => {
    const busId = await mixedBus();
    const made = await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);

    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const them = as("OWNER", other.userId, other.operatorId);
    expect((await them.get("/api/v1/schedules").expect(200)).body.total).toBe(0);
    await them.patch(`/api/v1/schedules/${made.body.id}`).send({ status: "INACTIVE" }).expect(404);
    await them.delete(`/api/v1/schedules/${made.body.id}`).expect(404);
    await them.post("/api/v1/schedules").send(schedule(busId)).expect(400); // not their bus

    await owner().delete(`/api/v1/schedules/${made.body.id}`).expect(204);
    expect(await prisma.trip.count()).toBe(0);
  });
});
