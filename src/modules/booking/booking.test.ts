import { decrypt, phoneHash } from "../../core/crypto";
import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";
import { createTripWithSeats } from "../trips/service";

const HOUR = 3_600_000;
let ids: { operatorId: string; userId: string };

async function addAgent(operatorId: string, email: string, commissionPct = 10) {
  return prisma.agent.create({
    data: { operatorId, name: "Anil Agent", phone: "9988776655", email, passwordHash: "x", agentCode: email.slice(0, 7), commissionPct },
  });
}

/** A 4-seat bus on Hyderabad → Bengaluru leaving in `inHours`. */
async function tripIn(operatorId: string, inHours: number) {
  const layout = await prisma.seatLayout.create({
    data: {
      operatorId,
      name: `L${inHours}`,
      totalSeats: 4,
      seats: ["L1", "L2", "U1", "U2"].map((number, i) => ({
        number,
        deck: number.startsWith("L") ? "LOWER" : "UPPER",
        row: 0,
        col: i % 2,
        type: "SLEEPER",
      })),
    },
  });
  const bus = await prisma.bus.create({
    data: { operatorId, registrationNo: `TS 09 AB ${inHours}`, name: "Volvo", seating: "SLEEPER", seatLayoutId: layout.id },
  });
  const route =
    (await prisma.route.findFirst({ where: { operatorId } })) ??
    (await prisma.route.create({
      data: {
        operatorId,
        origin: "Hyderabad",
        destination: "Bengaluru",
        baseFare: 1200,
        boardingPoints: ["Ameerpet", "LB Nagar"],
        droppingPoints: ["Majestic", "Silk Board"],
      },
    }));
  const trip = await createTripWithSeats(operatorId, {
    busId: bus.id,
    routeId: route.id,
    departureAt: new Date(Date.now() + inHours * HOUR),
    arrivalAt: new Date(Date.now() + (inHours + 8) * HOUR),
  });
  const seats = await prisma.tripSeat.findMany({ where: { tripId: trip.id }, orderBy: { seatNumber: "asc" } });
  return { trip, route, seats };
}

const person = (seatId: string, over: Record<string, unknown> = {}) => ({
  seatId,
  name: "Ramesh Kumar",
  age: 34,
  gender: "MALE",
  phone: "9876543210",
  idProofType: "AADHAAR",
  idProofNumber: "1234 5678 9012",
  ...over,
});

const order = (tripId: string, passengers: unknown[], over: Record<string, unknown> = {}) => ({
  tripId,
  source: "AGENT",
  boardingPoint: "Ameerpet",
  droppingPoint: "Majestic",
  paymentMode: "CASH",
  passengers,
  ...over,
});

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("finding a bus", () => {
  it("lists the owner's routes, then that day's buses with free-seat counts, filtered by type", async () => {
    const agent = await addAgent(ids.operatorId, "anil@example.com");
    const { trip, route } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", agent.id, ids.operatorId);

    const routes = await me.get("/api/v1/booking/routes").expect(200);
    expect(routes.body.items[0]).toMatchObject({ id: route.id, origin: "Hyderabad", boardingPoints: ["Ameerpet", "LB Nagar"] });

    const date = trip.departureAt.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const found = await me.get(`/api/v1/booking/trips?routeId=${route.id}&date=${date}`).expect(200);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0]).toMatchObject({
      id: trip.id,
      fare: "1200",
      totalSeats: 4,
      availableSeats: 4,
      bus: { name: "Volvo", seating: "SLEEPER", isAc: true },
    });

    expect((await me.get(`/api/v1/booking/trips?routeId=${route.id}&date=${date}&seating=SEATER`).expect(200)).body.total).toBe(0);
    await me.get(`/api/v1/booking/trips?routeId=${route.id}&date=tomorrow`).expect(400);
  });

  it("is for agents only", async () => {
    await as("OWNER", ids.userId, ids.operatorId).get("/api/v1/booking/routes").expect(403);
    await as("CONDUCTOR", ids.userId, ids.operatorId).get("/api/v1/booking/routes").expect(403);
  });
});

describe("booking seats", () => {
  it("books two seats under one PNR and stores passengers encrypted, with commission", async () => {
    const agent = await addAgent(ids.operatorId, "anil@example.com", 10);
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", agent.id, ids.operatorId);

    const res = await me
      .post("/api/v1/booking/bookings")
      .send(order(trip.id, [person(seats[0]!.id), person(seats[1]!.id, { name: "Sita Devi", gender: "FEMALE", phone: "9123456780" })]))
      .expect(201);
    expect(res.body).toMatchObject({ totalFare: "2400.00", commission: "240.00", boardingPoint: "Ameerpet" });
    expect(res.body.pnr).toMatch(/^KR[A-Z2-9]{6}$/);
    expect(res.body.bookings.map((b: { seatNumber: string }) => b.seatNumber)).toEqual(["L1", "L2"]);

    const rows = await prisma.booking.findMany({ where: { pnr: res.body.pnr }, include: { passenger: true, commission: true } });
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.passenger?.name === "Ramesh Kumar")!;
    expect(first).toMatchObject({ agentId: agent.id, status: "CONFIRMED", source: "AGENT", paymentMode: "CASH" });
    expect(first.commission).toMatchObject({ agentId: agent.id, status: "PENDING" });
    expect(first.commission!.amount.toFixed(2)).toBe("120.00");

    // Phone and ID never sit in the database as plain text, but can be read back and searched.
    expect(first.passenger!.phoneEnc).not.toContain("9876543210");
    expect(decrypt(first.passenger!.phoneEnc)).toBe("9876543210");
    expect(first.passenger!.phoneHash).toBe(phoneHash("9876543210"));
    expect(decrypt(first.passenger!.idProofEnc!)).toBe("1234 5678 9012");

    const map = await me.get(`/api/v1/booking/trips/${trip.id}/seats`).expect(200);
    const byNumber = Object.fromEntries(map.body.seats.map((s: { seatNumber: string }) => [s.seatNumber, s]));
    expect(byNumber.L1).toMatchObject({ status: "BOOKED", passengerGender: "MALE" });
    expect(byNumber.L2).toMatchObject({ status: "BOOKED", passengerGender: "FEMALE" });
    expect(byNumber.U1).toMatchObject({ status: "AVAILABLE", passengerGender: null });
    expect(JSON.stringify(map.body)).not.toMatch(/Ramesh|9876543210/);
  });

  it("lists an agent's own bookings with the passenger, and none of another agent's", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const b = await addAgent(ids.operatorId, "babu@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    await as("AGENT", a.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id)])).expect(201);

    const mine = await as("AGENT", a.id, ids.operatorId).get("/api/v1/booking/bookings").expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0]).toMatchObject({
      status: "CONFIRMED",
      source: "AGENT",
      fare: "1200",
      seatNumber: "L1",
      boardingPoint: "Ameerpet",
      passenger: { name: "Ramesh Kumar", age: 34, gender: "MALE", phone: "9876543210" },
      trip: { route: { origin: "Hyderabad", destination: "Bengaluru" }, bus: { name: "Volvo" } },
    });
    expect(JSON.stringify(mine.body)).not.toMatch(/phoneEnc|idProof/);

    expect((await as("AGENT", b.id, ids.operatorId).get("/api/v1/booking/bookings").expect(200)).body.total).toBe(0);
  });

  it("cancels a ticket: seat back on sale, commission voided, and it can be sold again", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const b = await addAgent(ids.operatorId, "babu@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", a.id, ids.operatorId);
    const made = await me.post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id)])).expect(201);
    const bookingId = made.body.bookings[0].id;

    // Another agent cannot cancel it.
    await as("AGENT", b.id, ids.operatorId).post(`/api/v1/booking/bookings/${bookingId}/cancel`).expect(404);

    const res = await me.post(`/api/v1/booking/bookings/${bookingId}/cancel`).expect(200);
    expect(res.body.status).toBe("CANCELLED");
    expect((await prisma.tripSeat.findUniqueOrThrow({ where: { id: seats[0]!.id } })).status).toBe("AVAILABLE");
    expect((await prisma.commissionLedger.findUniqueOrThrow({ where: { bookingId } })).status).toBe("VOID");
    await me.post(`/api/v1/booking/bookings/${bookingId}/cancel`).expect(409);

    // The freed seat sells again, alongside the cancelled booking.
    await as("AGENT", b.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id)])).expect(201);
    expect(await prisma.booking.count({ where: { tripSeatId: seats[0]!.id } })).toBe(2);
  });

  it("the owner sees every agent's bookings with the agent named, and can cancel one", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const b = await addAgent(ids.operatorId, "babu@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    await as("AGENT", a.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id), person(seats[1]!.id)])).expect(201);
    await as("AGENT", b.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[2]!.id)], { source: "COUNTER" })).expect(201);

    const owner = as("OWNER", ids.userId, ids.operatorId);
    const all = await owner.get("/api/v1/bookings").expect(200);
    expect(all.body.total).toBe(3);
    const first = all.body.items.find((x: { seatNumber: string }) => x.seatNumber === "L1");
    expect(first).toMatchObject({
      status: "CONFIRMED",
      channel: "OWN_AGENT",
      deck: "LOWER",
      fare: "1200",
      agent: { id: a.id, name: "Anil Agent" },
      passenger: { name: "Ramesh Kumar", phone: "9876543210", idProofType: "AADHAAR", boarded: false },
      trip: { route: { origin: "Hyderabad" } },
    });
    expect(JSON.stringify(all.body)).not.toMatch(/phoneEnc|idProofEnc|1234 5678 9012/);

    await owner.post(`/api/v1/bookings/${first.id}/cancel`).expect(200);
    expect((await prisma.tripSeat.findUniqueOrThrow({ where: { id: seats[0]!.id } })).status).toBe("AVAILABLE");

    // Agents cannot use the owner's list, and another operator's owner sees nothing.
    await as("AGENT", a.id, ids.operatorId).get("/api/v1/bookings").expect(403);
    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const theirs = as("OWNER", other.userId, other.operatorId);
    expect((await theirs.get("/api/v1/bookings").expect(200)).body.total).toBe(0);
    await theirs.post(`/api/v1/bookings/${all.body.items[0].id}/cancel`).expect(404);
  });

  it("an agent who has sold tickets cannot be deleted, only deactivated", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    await as("AGENT", a.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id)])).expect(201);

    const res = await as("OWNER", ids.userId, ids.operatorId).delete(`/api/v1/agents/${a.id}`).expect(409);
    expect(res.body.error.code).toBe("CONFLICT");
    expect(await prisma.agent.count({ where: { id: a.id } })).toBe(1);
  });

  it("will not cancel after the bus has left or once the passenger has boarded", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", a.id, ids.operatorId);
    const made = await me.post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id), person(seats[1]!.id)])).expect(201);
    const [first, second] = made.body.bookings;

    await prisma.booking.update({ where: { id: first.id }, data: { status: "BOARDED" } });
    await me.post(`/api/v1/booking/bookings/${first.id}/cancel`).expect(409);

    await prisma.trip.update({ where: { id: trip.id }, data: { departureAt: new Date(Date.now() - HOUR) } });
    await me.post(`/api/v1/booking/bookings/${second.id}/cancel`).expect(409);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("CONFIRMED");
  });

  it("refuses a seat that is already booked and leaves nothing half-done", async () => {
    const agent = await addAgent(ids.operatorId, "anil@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", agent.id, ids.operatorId);
    await me.post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id)])).expect(201);

    const res = await me
      .post("/api/v1/booking/bookings")
      .send(order(trip.id, [person(seats[1]!.id), person(seats[0]!.id)]))
      .expect(409);
    expect(res.body.error.code).toBe("SEAT_UNAVAILABLE");
    expect(await prisma.booking.count()).toBe(1);
    expect((await prisma.tripSeat.findUniqueOrThrow({ where: { id: seats[1]!.id } })).status).toBe("AVAILABLE");
  });

  it("lets exactly one of two simultaneous bookings for the same seat through", async () => {
    const a = await addAgent(ids.operatorId, "anil@example.com");
    const b = await addAgent(ids.operatorId, "babu@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const body = order(trip.id, [person(seats[2]!.id)]);

    const results = await Promise.all([
      as("AGENT", a.id, ids.operatorId).post("/api/v1/booking/bookings").send(body),
      as("AGENT", b.id, ids.operatorId).post("/api/v1/booking/bookings").send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.booking.count({ where: { tripSeatId: seats[2]!.id } })).toBe(1);
  });

  it("validates passengers and stops", async () => {
    const agent = await addAgent(ids.operatorId, "anil@example.com");
    const { trip, seats } = await tripIn(ids.operatorId, 30);
    const me = as("AGENT", agent.id, ids.operatorId);

    const bad = await me
      .post("/api/v1/booking/bookings")
      .send(order(trip.id, [person(seats[0]!.id, { name: "=HYPERLINK(1)", phone: "12345", age: 0, idProofNumber: "x" })]))
      .expect(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual([
      "passengers.0.age",
      "passengers.0.idProofNumber",
      "passengers.0.name",
      "passengers.0.phone",
    ]);

    await me.post("/api/v1/booking/bookings").send(order(trip.id, [person(seats[0]!.id), person(seats[0]!.id)])).expect(400);
    const stop = await me
      .post("/api/v1/booking/bookings")
      .send(order(trip.id, [person(seats[0]!.id)], { boardingPoint: "Nowhere" }))
      .expect(400);
    expect(stop.body.error.details).toHaveProperty("boardingPoint");
    expect(await prisma.booking.count()).toBe(0);
  });

  it("cannot book a departed trip or another operator's trip", async () => {
    const agent = await addAgent(ids.operatorId, "anil@example.com");
    const me = as("AGENT", agent.id, ids.operatorId);
    const past = await tripIn(ids.operatorId, -2);
    await me.post("/api/v1/booking/bookings").send(order(past.trip.id, [person(past.seats[0]!.id)])).expect(404);

    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const theirs = await tripIn(other.operatorId, 30);
    await me.post("/api/v1/booking/bookings").send(order(theirs.trip.id, [person(theirs.seats[0]!.id)])).expect(404);
    await me.get(`/api/v1/booking/trips/${theirs.trip.id}/seats`).expect(404);
    expect(await prisma.booking.count()).toBe(0);
  });
});
