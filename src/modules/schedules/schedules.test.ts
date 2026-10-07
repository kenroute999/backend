import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";
import { designedSeats } from "../buses/layouts";

const HOUR = 3_600_000;
let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);
const inHours = (h: number) => new Date(Date.now() + h * HOUR).toISOString();

const bus = { registrationNo: "ts 09 ab 1234", name: "KenRoute Volvo", seating: "SEATER_SLEEPER", isAc: true };

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

describe("seat layouts", () => {
  it("match the plans drawn in Admin: counts, decks, aisle and bed kinds", () => {
    const sleeper = designedSeats("SLEEPER");
    expect(sleeper).toHaveLength(36);
    expect(sleeper.filter((s) => s.deck === "UPPER")).toHaveLength(18);
    expect(sleeper.some((s) => s.col === 1)).toBe(false); // the aisle stays empty
    expect(sleeper.filter((s) => s.type === "DOUBLE_SLEEPER")).toHaveLength(24);
    expect(new Set(sleeper.map((s) => s.number)).size).toBe(36);

    // The 37-seat sleeper: the same bus plus L19, one single bed in the aisle behind the last row.
    const withBack = designedSeats("SLEEPER_37");
    expect(withBack).toHaveLength(37);
    expect(withBack.filter((s) => s.col === 1)).toEqual([
      { number: "L19", deck: "LOWER", row: 6, col: 1, type: "SLEEPER", ladiesOnly: false },
    ]);
    expect(withBack.filter((s) => s.deck === "UPPER").map((s) => s.number)).toContain("U37");

    const seater = designedSeats("SEATER");
    expect(seater).toHaveLength(45);
    expect(seater.every((s) => s.deck === "LOWER" && s.type === "SEATER")).toBe(true);
    expect(seater.filter((s) => s.row === 10)).toHaveLength(5); // back bench

    const mixed = designedSeats("SEATER_SLEEPER");
    expect(mixed).toHaveLength(48);
    expect(mixed.filter((s) => s.deck === "LOWER" && s.type === "SEATER")).toHaveLength(24);
    expect(mixed.filter((s) => s.deck === "LOWER" && s.type === "SLEEPER")).toHaveLength(6);
  });

  it("a new bus gets the layout of its kind and its trips are priced by seat kind", async () => {
    const made = await owner().post("/api/v1/buses").send({ ...bus, seating: "SLEEPER" }).expect(201);
    expect(made.body).toMatchObject({ seats: 36, seatLayout: { name: "Sleeper (2+1)" } });
    const trip = await owner()
      .post("/api/v1/schedules")
      .send(schedule(made.body.id, { fares: { singleBed: 1400, doubleBed: 950 } }))
      .expect(201);
    const byType = await prisma.tripSeat.groupBy({ by: ["seatType", "fare"], where: { tripId: trip.body.id }, _count: true });
    expect(byType.map((g) => [g.seatType, g.fare.toFixed(0), g._count]).sort()).toEqual([
      ["DOUBLE_SLEEPER", "950", 24],
      ["SLEEPER", "1400", 12],
    ]);
  });

  it("a sleeper added with 37 seats gets the back bed L19 as a real seat, and keeps it on later edits", async () => {
    const made = await owner().post("/api/v1/buses").send({ ...bus, seating: "SLEEPER", seats: 37 }).expect(201);
    expect(made.body).toMatchObject({ seating: "SLEEPER", seats: 37 });
    const url = `/api/v1/buses/${made.body.id}`;
    expect((await owner().patch(url).send({ name: "Renamed" }).expect(200)).body.seats).toBe(37);

    const trip = await owner().post("/api/v1/schedules").send(schedule(made.body.id, { fares: { singleBed: 1400, doubleBed: 950 } })).expect(201);
    const back = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: trip.body.id, seatNumber: "L19" } });
    expect(back).toMatchObject({ deck: "LOWER", col: 1, seatType: "SLEEPER", status: "AVAILABLE" });
    expect(back.fare.toFixed(0)).toBe("1400");
    expect(await prisma.tripSeat.count({ where: { tripId: trip.body.id } })).toBe(37);

    // Seats are on sale, so the layout cannot change under them; another kind of bus ignores 37.
    await owner().patch(url).send({ seats: 36 }).expect(409);
    const seater = await owner().post("/api/v1/buses").send({ ...bus, registrationNo: "TS 09 ZZ 0001", seating: "SEATER", seats: 37 }).expect(201);
    expect(seater.body.seats).toBe(45);
  });
});

describe("buses", () => {
  it("creates, lists, updates and deletes a bus; blocks a duplicate number", async () => {
    const made = await owner().post("/api/v1/buses").send(bus).expect(201);
    expect(made.body).toMatchObject({ registrationNo: "TS 09 AB 1234", seating: "SEATER_SLEEPER", isAc: true, seats: 48, status: "ACTIVE" });
    await owner().post("/api/v1/buses").send(bus).expect(409);
    await owner().post("/api/v1/buses").send({ ...bus, registrationNo: "x" }).expect(400);

    const changed = await owner().patch(`/api/v1/buses/${made.body.id}`).send({ name: "Renamed", seating: "SEATER", status: "MAINTENANCE" }).expect(200);
    expect(changed.body).toMatchObject({ name: "Renamed", seating: "SEATER", seats: 45, status: "MAINTENANCE" });
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

  it("a bus under maintenance or inactive cannot be given a trip, new or by switching", async () => {
    const good = await mixedBus();
    const trip = await owner().post("/api/v1/schedules").send(schedule(good)).expect(201);
    const spare = await owner().post("/api/v1/buses").send({ ...bus, registrationNo: "TS 09 XX 0001" }).expect(201);

    for (const status of ["MAINTENANCE", "INACTIVE"]) {
      await owner().patch(`/api/v1/buses/${spare.body.id}`).send({ status }).expect(200);
      const refused = await owner().post("/api/v1/schedules").send(schedule(spare.body.id, { departureAt: inHours(100), arrivalAt: inHours(109) })).expect(409);
      expect(refused.body.error.message).toMatch(/TS 09 XX 0001 is (under maintenance|inactive)/);
      await owner().patch(`/api/v1/schedules/${trip.body.id}`).send({ busId: spare.body.id }).expect(409);
    }
    expect(await prisma.trip.count()).toBe(1);

    // Back in service: it can run again.
    await owner().patch(`/api/v1/buses/${spare.body.id}`).send({ status: "ACTIVE" }).expect(200);
    await owner().post("/api/v1/schedules").send(schedule(spare.body.id, { departureAt: inHours(100), arrivalAt: inHours(109) })).expect(201);
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

  it("shows the owner each seat with its ticket, and lets a free seat be blocked and released", async () => {
    const busId = await mixedBus();
    const made = await owner().post("/api/v1/schedules").send(schedule(busId)).expect(201);
    const url = `/api/v1/schedules/${made.body.id}/seats`;
    const agent = await prisma.agent.create({
      data: { operatorId: ids.operatorId, name: "Anil", phone: "9988776655", email: "anil@example.com", passwordHash: "x", agentCode: "AGT1", commissionPct: 10 },
    });
    const desk = as("AGENT", agent.id, ids.operatorId);
    const before = (await owner().get(url).expect(200)).body.seats;
    expect(before).toHaveLength(4);
    const [sold, free] = before;
    await desk
      .post("/api/v1/booking/bookings")
      .send({
        tripId: made.body.id,
        source: "AGENT",
        boardingPoint: "Ameerpet",
        droppingPoint: "Majestic",
        paymentMode: "CASH",
        passengers: [{ seatId: sold.id, name: "Lakshmi Devi", age: 30, gender: "FEMALE", phone: "9876543210", idProofType: "AADHAAR", idProofNumber: "123456789012" }],
      })
      .expect(201);

    await owner().patch(`${url}/${free.id}`).send({ blocked: true }).expect(200);
    await owner().patch(`${url}/${free.id}`).send({ blocked: true }).expect(409);
    await owner().patch(`${url}/${sold.id}`).send({ blocked: true }).expect(409); // sold seats stay sold

    const after = (await owner().get(url).expect(200)).body.seats;
    expect(after.find((s: { id: string }) => s.id === sold.id)).toMatchObject({
      status: "BOOKED",
      booking: { boardingPoint: "Ameerpet", agent: { name: "Anil" }, passenger: { name: "Lakshmi Devi", gender: "FEMALE" } },
    });
    expect(after.find((s: { id: string }) => s.id === free.id)).toMatchObject({ status: "BLOCKED", booking: null });
    expect(JSON.stringify(after)).not.toMatch(/9876543210/);
    // A blocked seat cannot be sold.
    await desk
      .post("/api/v1/booking/bookings")
      .send({ tripId: made.body.id, source: "AGENT", boardingPoint: "Ameerpet", droppingPoint: "Majestic", paymentMode: "CASH", passengers: [{ seatId: free.id, name: "Ramesh Kumar", age: 30, gender: "MALE", phone: "9876543210", idProofType: "AADHAAR", idProofNumber: "123456789012" }] })
      .expect(409);
    await owner().patch(`${url}/${free.id}`).send({ blocked: false }).expect(200);

    // Ladies only: the owner marks a free seat; it shows as kept for women, a man is refused, a woman books it.
    const lady = after.find((s: { status: string; id: string }) => s.status === "AVAILABLE" && s.id !== free.id);
    await owner().patch(`${url}/${lady.id}`).send({ ladiesOnly: true }).expect(200);
    await owner().patch(`${url}/${sold.id}`).send({ ladiesOnly: true }).expect(409);
    await owner().patch(`${url}/${lady.id}`).send({ ladiesOnly: true, blocked: true }).expect(400);
    const marked = (await owner().get(url).expect(200)).body.seats.find((s: { id: string }) => s.id === lady.id);
    expect(marked).toMatchObject({ ladiesOnly: true, reservedFor: "FEMALE" });
    const seatOrder = (gender: string) => ({ tripId: made.body.id, source: "AGENT", boardingPoint: "Ameerpet", droppingPoint: "Majestic", paymentMode: "CASH", passengers: [{ seatId: lady.id, name: "Asha Rao", age: 30, gender, phone: "9876543210", idProofType: "AADHAAR", idProofNumber: "123456789012" }] });
    const refused = await desk.post("/api/v1/booking/bookings").send(seatOrder("MALE")).expect(409);
    expect(refused.body.error).toMatchObject({ code: "SEAT_GENDER", message: expect.stringContaining("women only") });
    await desk.post("/api/v1/booking/bookings").send(seatOrder("FEMALE")).expect(201);

    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const them = as("OWNER", other.userId, other.operatorId);
    await them.patch(`${url}/${free.id}`).send({ ladiesOnly: true }).expect(409);
    await them.get(url).expect(404);
    await them.patch(`${url}/${free.id}`).send({ blocked: true }).expect(409);
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
