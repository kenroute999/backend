import bcrypt from "bcrypt";
import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";
import { createTripWithSeats } from "../trips/service";

const conductor = { name: "Suresh Conductor", phone: "9111111111", password: "Secret@123" };
const HOUR = 3_600_000;

const seats = [
  { number: "L1", deck: "LOWER", row: 0, col: 0, type: "SLEEPER" },
  { number: "U1", deck: "UPPER", row: 0, col: 0, type: "SLEEPER" },
  { number: "L2", deck: "LOWER", row: 0, col: 1, type: "SLEEPER" },
];

/** A bus, a route, and trips departing the given number of hours from now. */
async function fleet(operatorId: string, ...departInHours: number[]) {
  const layout = await prisma.seatLayout.create({ data: { operatorId, name: "L", seats, totalSeats: seats.length } });
  const bus = await prisma.bus.create({
    data: { operatorId, registrationNo: "TS 09 AB 1234", seating: "SLEEPER", seatLayoutId: layout.id },
  });
  const route = await prisma.route.create({
    data: { operatorId, origin: "Hyderabad", destination: "Bengaluru", baseFare: 1200 },
  });
  const trips = [];
  for (const h of departInHours) {
    trips.push(
      await createTripWithSeats(operatorId, {
        busId: bus.id,
        routeId: route.id,
        departureAt: new Date(Date.now() + h * HOUR),
        arrivalAt: new Date(Date.now() + (h + 8) * HOUR),
      }),
    );
  }
  return { bus, route, trips };
}

let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("trips", () => {
  it("creates one seat per layout seat, takes the route fare, and rejects an overlapping trip for the bus", async () => {
    const { operatorId } = ids;
    const { bus, route, trips } = await fleet(operatorId, 24);

    expect(await prisma.tripSeat.count({ where: { tripId: trips[0]!.id } })).toBe(3);
    expect(trips[0]!.fare.toString()).toBe("1200");

    await expect(
      createTripWithSeats(operatorId, {
        busId: bus.id,
        routeId: route.id,
        departureAt: new Date(Date.now() + 28 * HOUR),
        arrivalAt: new Date(Date.now() + 36 * HOUR),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lists only upcoming trips, soonest first, filtered by bus", async () => {
    const { bus } = await fleet(ids.operatorId, 48, -30, 24);

    const res = await owner().get(`/api/v1/trips?busId=${bus.id}`).expect(200);
    expect(res.body.total).toBe(2);
    expect(new Date(res.body.items[0].departureAt) < new Date(res.body.items[1].departureAt)).toBe(true);
    expect(res.body.items[0]).toMatchObject({
      bus: { registrationNo: "TS 09 AB 1234" },
      route: { origin: "Hyderabad", destination: "Bengaluru" },
      conductor: null,
    });
    const none = await owner().get("/api/v1/trips?busId=00000000-0000-4000-8000-000000000000").expect(200);
    expect(none.body.total).toBe(0);
  });
});

describe("conductors API", () => {
  it("creates with name, mobile and password; hashes the password; blocks a duplicate mobile", async () => {
    const res = await owner().post("/api/v1/conductors").send(conductor).expect(201);
    expect(res.body).toMatchObject({ name: "Suresh Conductor", phone: "9111111111", isActive: true, trip: null });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const row = await prisma.conductor.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(await bcrypt.compare(conductor.password, row.passwordHash)).toBe(true);

    const twin = await owner().post("/api/v1/conductors").send({ ...conductor, name: "Twin" }).expect(409);
    expect(twin.body.error.message).toBe("This mobile number is already used by your conductor Suresh Conductor");

    // Another company trying the same number is refused without a word about who holds it.
    const other = await seedOwner("Shiva Travels", "shiva@example.com");
    const refused = await as("OWNER", other.userId, other.operatorId).post("/api/v1/conductors").send(conductor).expect(409);
    expect(refused.body.error.message).toBe("This mobile number cannot be used. Enter a different number.");
    expect(JSON.stringify(refused.body)).not.toMatch(/Suresh|another|already/i);
    await owner().post("/api/v1/conductors").send({ ...conductor, phone: "123" }).expect(400);
  });

  it("assigns a trip, moves to another trip, and clears it", async () => {
    const { body } = await owner().post("/api/v1/conductors").send(conductor).expect(201);
    const { trips } = await fleet(ids.operatorId, 24, 48);
    const [first, second] = [trips[0]!, trips[1]!];
    const url = `/api/v1/conductors/${body.id}`;

    const assigned = await owner().patch(url).send({ tripId: first.id }).expect(200);
    expect(assigned.body.trip).toMatchObject({
      id: first.id,
      bus: { registrationNo: "TS 09 AB 1234" },
      route: { origin: "Hyderabad", destination: "Bengaluru" },
    });
    expect(assigned.body.trip.departureAt).toBe(first.departureAt.toISOString());

    const moved = await owner().patch(url).send({ tripId: second.id }).expect(200);
    expect(moved.body.trip.id).toBe(second.id);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: first.id } })).conductorId).toBeNull();

    // Editing other fields leaves the assignment alone.
    const renamed = await owner().patch(url).send({ name: "Suresh K" }).expect(200);
    expect(renamed.body.trip.id).toBe(second.id);

    const cleared = await owner().patch(url).send({ tripId: null }).expect(200);
    expect(cleared.body.trip).toBeNull();
  });

  it("refuses a trip that already has another conductor, a past trip, and another operator's trip", async () => {
    const a = await owner().post("/api/v1/conductors").send(conductor).expect(201);
    const b = await owner().post("/api/v1/conductors").send({ ...conductor, phone: "9333333333" }).expect(201);
    const { trips } = await fleet(ids.operatorId, 24, -30);
    const [upcoming, past] = [trips[0]!, trips[1]!];

    await owner().patch(`/api/v1/conductors/${a.body.id}`).send({ tripId: upcoming.id }).expect(200);
    const taken = await owner().patch(`/api/v1/conductors/${b.body.id}`).send({ tripId: upcoming.id }).expect(409);
    expect(taken.body.error.message).toContain("Suresh Conductor");
    await owner().patch(`/api/v1/conductors/${b.body.id}`).send({ tripId: past.id }).expect(400);

    const other = await prisma.operator.create({ data: { name: "Other Travels" } });
    const foreign = await fleet(other.id, 24);
    const res = await owner().patch(`/api/v1/conductors/${b.body.id}`).send({ tripId: foreign.trips[0]!.id }).expect(400);
    expect(res.body.error.details).toHaveProperty("tripId");
    expect((await owner().get("/api/v1/trips").expect(200)).body.total).toBe(1);
  });

  it("deleting a conductor frees their upcoming trip; another operator's conductor is untouchable", async () => {
    const { body } = await owner().post("/api/v1/conductors").send(conductor).expect(201);
    const { trips } = await fleet(ids.operatorId, 24);
    await owner().patch(`/api/v1/conductors/${body.id}`).send({ tripId: trips[0]!.id }).expect(200);
    await owner().delete(`/api/v1/conductors/${body.id}`).expect(204);
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trips[0]!.id } })).conductorId).toBeNull();

    const other = await prisma.operator.create({ data: { name: "Other Travels" } });
    const theirs = await prisma.conductor.create({
      data: { operatorId: other.id, name: "Foreign", phone: "9222222222", passwordHash: "x" },
    });
    await owner().patch(`/api/v1/conductors/${theirs.id}`).send({ name: "Hacked" }).expect(404);
    await owner().delete(`/api/v1/conductors/${theirs.id}`).expect(404);
  });
});
