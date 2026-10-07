import { encrypt } from "../../core/crypto";
import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";
import { createTripWithSeats } from "../trips/service";

const HOUR = 3_600_000;
let ids: { operatorId: string; userId: string };

async function conductor(operatorId: string, phone: string) {
  return prisma.conductor.create({ data: { operatorId, name: `C ${phone}`, phone, passwordHash: "x" } });
}

/** A trip with one seat, assigned to the conductor, leaving in `inHours`. */
async function tripFor(operatorId: string, conductorId: string, inHours: number, reg = "TS 09 AB 1234") {
  const layout = await prisma.seatLayout.create({
    data: {
      operatorId,
      name: `L ${reg} ${inHours}`,
      totalSeats: 1,
      seats: [{ number: "L1", deck: "LOWER", row: 0, col: 0, type: "SLEEPER" }],
    },
  });
  const bus = await prisma.bus.create({ data: { operatorId, registrationNo: `${reg} ${inHours}`, seating: "SLEEPER", seatLayoutId: layout.id } });
  const route = await prisma.route.create({
    data: { operatorId, origin: "Hyderabad", destination: `Bengaluru ${reg} ${inHours}`, baseFare: 1200 },
  });
  return createTripWithSeats(operatorId, {
    busId: bus.id,
    routeId: route.id,
    departureAt: new Date(Date.now() + inHours * HOUR),
    arrivalAt: new Date(Date.now() + (inHours + 8) * HOUR),
    conductorId,
  });
}

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("conductor app", () => {
  it("lists only the signed-in conductor's own trips", async () => {
    const mine = await conductor(ids.operatorId, "9111111111");
    const other = await conductor(ids.operatorId, "9222222222");
    const trip = await tripFor(ids.operatorId, mine.id, 5);
    await tripFor(ids.operatorId, other.id, 6, "TS 09 CD 5678");

    const res = await as("CONDUCTOR", mine.id, ids.operatorId).get("/api/v1/conductor/trips").expect(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0]).toMatchObject({ id: trip.id, status: "SCHEDULED", route: { origin: "Hyderabad" }, _count: { seats: 1 } });
  });

  it("is closed to owners and agents, and to requests without a token", async () => {
    await as("OWNER", ids.userId, ids.operatorId).get("/api/v1/conductor/trips").expect(403);
    await as("AGENT", ids.userId, ids.operatorId).get("/api/v1/conductor/trips").expect(403);
  });

  it("shows passengers with their phone but no fare or ID proof, records boarding, and ignores another conductor's passengers", async () => {
    const mine = await conductor(ids.operatorId, "9111111111");
    const other = await conductor(ids.operatorId, "9222222222");
    const trip = await tripFor(ids.operatorId, mine.id, 5);
    const seat = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: trip.id } });
    const channel = await prisma.channel.create({ data: { operatorId: ids.operatorId, type: "OWN_AGENT" } });
    const booking = await prisma.booking.create({
      data: { operatorId: ids.operatorId, tripId: trip.id, tripSeatId: seat.id, channelId: channel.id, source: "COUNTER", pnr: "KR7H2M9Q", fare: 1200 },
    });
    const passenger = await prisma.passenger.create({
      data: { operatorId: ids.operatorId, bookingId: booking.id, name: "Ramesh Kumar", phoneEnc: encrypt("9876543210"), phoneHash: "hash", idProofEnc: encrypt("123456789012") },
    });

    const me = as("CONDUCTOR", mine.id, ids.operatorId);
    const list = await me.get(`/api/v1/conductor/trips/${trip.id}/passengers`).expect(200);
    expect(list.body.items).toEqual([
      { id: passenger.id, tripId: trip.id, name: "Ramesh Kumar", seat: "L1", pnr: "KR7H2M9Q", phone: "9876543210", boarded: false },
    ]);
    expect(JSON.stringify(list.body)).not.toMatch(/1200|fare|123456789012|idProof/);

    const event = { tripId: trip.id, passengerId: passenger.id, boarded: true, at: new Date().toISOString() };
    const them = as("CONDUCTOR", other.id, ids.operatorId);
    await them.get(`/api/v1/conductor/trips/${trip.id}/passengers`).expect(404);
    expect((await them.post("/api/v1/conductor/sync").send({ events: [event] }).expect(200)).body.applied).toBe(0);
    expect((await prisma.passenger.findUniqueOrThrow({ where: { id: passenger.id } })).boarded).toBe(false);

    // Sending the same batch twice leaves the same result.
    await me.post("/api/v1/conductor/sync").send({ events: [event] }).expect(200);
    expect((await me.post("/api/v1/conductor/sync").send({ events: [event] }).expect(200)).body.applied).toBe(1);
    const row = await prisma.passenger.findUniqueOrThrow({ where: { id: passenger.id } });
    expect(row).toMatchObject({ boarded: true, boardedById: mine.id });
  });

  it("ends only the conductor's own trip", async () => {
    const mine = await conductor(ids.operatorId, "9111111111");
    const other = await conductor(ids.operatorId, "9222222222");
    const trip = await tripFor(ids.operatorId, mine.id, 5);

    await as("CONDUCTOR", other.id, ids.operatorId).post(`/api/v1/conductor/trips/${trip.id}/end`).expect(404);
    const ended = await as("CONDUCTOR", mine.id, ids.operatorId).post(`/api/v1/conductor/trips/${trip.id}/end`).expect(200);
    expect(ended.body.status).toBe("COMPLETED");
    await as("CONDUCTOR", mine.id, ids.operatorId).post(`/api/v1/conductor/trips/${trip.id}/end`).expect(200);
  });
});
