import request from "supertest";
import { app } from "../../app";
import { encrypt, phoneHash } from "../../core/crypto";
import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";
import { createTripWithSeats } from "../trips/service";

const HOUR = 3_600_000;
const fix = { latitude: 17.385, longitude: 78.4867, accuracy: 12, speed: 8.3, heading: 90 };
let ids: { operatorId: string; userId: string };

/** A conductor with a trip leaving in `inHours`, and one ticket (PNR) sold on it. */
async function journey(operatorId: string, inHours: number, pnr: string, phone = "9111111111") {
  const conductor = await prisma.conductor.create({ data: { operatorId, name: "Suresh", phone, passwordHash: "x" } });
  const layout = await prisma.seatLayout.create({
    data: { operatorId, name: `L ${pnr}`, totalSeats: 1, seats: [{ number: "L1", deck: "LOWER", row: 0, col: 0, type: "SLEEPER" }] },
  });
  const bus = await prisma.bus.create({ data: { operatorId, registrationNo: `TS 09 ${pnr}`, name: "Volvo", seating: "SLEEPER", seatLayoutId: layout.id } });
  const route = await prisma.route.create({ data: { operatorId, origin: "Hyderabad", destination: `Bengaluru ${pnr}`, baseFare: 1200 } });
  const trip = await createTripWithSeats(operatorId, {
    busId: bus.id,
    routeId: route.id,
    departureAt: new Date(Date.now() + inHours * HOUR),
    arrivalAt: new Date(Date.now() + (inHours + 8) * HOUR),
    conductorId: conductor.id,
  });
  const seat = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: trip.id } });
  const channel = await prisma.channel.upsert({
    where: { operatorId_type: { operatorId, type: "OWN_AGENT" } },
    update: {},
    create: { operatorId, type: "OWN_AGENT", status: "CONNECTED" },
  });
  await prisma.booking.create({
    data: { operatorId, tripId: trip.id, tripSeatId: seat.id, channelId: channel.id, source: "AGENT", pnr, fare: 1200, boardingPoint: "Ameerpet", droppingPoint: "Majestic" },
  });
  return { conductor, trip, phone: as("CONDUCTOR", conductor.id, operatorId) };
}

const lookup = (body: object) => request(app).post("/api/v1/tracking/lookup").send(body);
const location = (token: string) => request(app).get("/api/v1/tracking/location").set("Authorization", `Bearer ${token}`);

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("live bus tracking", () => {
  it("the conductor's position reaches the passenger who knows the PNR", async () => {
    const { trip, phone } = await journey(ids.operatorId, 0.5, "KRTRK123");

    const before = await lookup({ pnr: "krtrk123" }).expect(200);
    expect(before.body).toMatchObject({ location: null, trip: { origin: "Hyderabad", status: "SCHEDULED", bus: { name: "Volvo" } } });
    // Nothing about the passenger, the fare or the company comes back.
    expect(JSON.stringify(before.body)).not.toMatch(/fare|phone|passenger|operatorId|conductor/i);

    await phone.post(`/api/v1/conductor/trips/${trip.id}/location`).send(fix).expect(201);
    const seen = await location(before.body.token).expect(200);
    expect(seen.body.location).toMatchObject({ latitude: 17.385, longitude: 78.4867, speed: 8.3 });

    // The phone's background key reports too, and the newest position wins.
    const key = await phone.post(`/api/v1/conductor/trips/${trip.id}/gps-key`).expect(200);
    await request(app).post("/api/v1/tracking/fix").set("Authorization", `Bearer ${key.body.token}`).send({ ...fix, latitude: 17.5 }).expect(201);
    expect((await location(before.body.token).expect(200)).body.location.latitude).toBe(17.5);

    // Once the trip has ended the bus is no longer shown, and no more positions are taken.
    await phone.post(`/api/v1/conductor/trips/${trip.id}/end`).expect(200);
    expect((await location(before.body.token).expect(200)).body).toMatchObject({ location: null, trip: { status: "COMPLETED" } });
    await phone.post(`/api/v1/conductor/trips/${trip.id}/location`).send(fix).expect(409);
  });

  it("opens the same trip for the mobile number the ticket was booked with", async () => {
    await journey(ids.operatorId, 0.5, "KRPASS01");
    const booking = await prisma.booking.findFirstOrThrow({ where: { pnr: "KRPASS01" } });
    await prisma.passenger.create({
      data: { operatorId: ids.operatorId, bookingId: booking.id, name: "Ramesh", phoneEnc: encrypt("9876543210"), phoneHash: phoneHash("9876543210") },
    });

    const found = await lookup({ mobile: "9876543210" }).expect(200);
    expect(found.body).toMatchObject({ trip: { origin: "Hyderabad", status: "SCHEDULED" } });
    // A mobile with no booking, and a malformed one, are refused.
    await lookup({ mobile: "9000000000" }).expect(404);
    await lookup({ mobile: "98765" }).expect(400);
  });

  it("refuses unknown PNRs, mobile numbers, bad positions and positions outside the journey", async () => {
    const { trip, phone } = await journey(ids.operatorId, 30, "KRLATER1");
    await lookup({ pnr: "KRXXXX99" }).expect(404);
    await lookup({ mobile: "9876543210" }).expect(404);
    await lookup({ mobile: "12345" }).expect(400);
    await lookup({ pnr: "' OR 1=1 --" }).expect(400);

    // A trip leaving tomorrow: the conductor's whereabouts today are nobody's business.
    await phone.post(`/api/v1/conductor/trips/${trip.id}/location`).send(fix).expect(409);
    expect(await prisma.tripLocation.count()).toBe(0);

    const soon = await journey(ids.operatorId, 0.5, "KRSOON12", "9222222222");
    const url = `/api/v1/conductor/trips/${soon.trip.id}/location`;
    await soon.phone.post(url).send({ ...fix, latitude: 123 }).expect(400);
    await soon.phone.post(url).send({ ...fix, extra: true }).expect(400);
    // Another conductor cannot report for this trip.
    await phone.post(url).send(fix).expect(404);
    await phone.post(`/api/v1/conductor/trips/${soon.trip.id}/gps-key`).expect(404);
  });

  it("starting the trip opens tracking early, but not days ahead", async () => {
    // Leaves in 90 minutes: too early for tracking by the clock, but the conductor may start it.
    const { trip, phone } = await journey(ids.operatorId, 1.5, "KRSTART1");
    const url = `/api/v1/conductor/trips/${trip.id}`;
    await phone.post(`${url}/location`).send(fix).expect(409);

    const started = await phone.post(`${url}/start`).expect(200);
    expect(started.body.startedAt).toBeTruthy();
    expect((await phone.post(`${url}/start`).expect(200)).body.startedAt).toBe(started.body.startedAt);
    await phone.post(`${url}/location`).send(fix).expect(201);

    // The passenger sees a trip in progress; tickets can still be sold on it.
    expect((await lookup({ pnr: "KRSTART1" }).expect(200)).body).toMatchObject({ trip: { status: "IN_PROGRESS" }, location: { latitude: 17.385 } });
    expect((await prisma.trip.findUniqueOrThrow({ where: { id: trip.id } })).status).toBe("SCHEDULED");

    const later = await journey(ids.operatorId, 30, "KRLATER2", "9222222222");
    await later.phone.post(`/api/v1/conductor/trips/${later.trip.id}/start`).expect(409);
    await phone.post(`/api/v1/conductor/trips/${later.trip.id}/start`).expect(404); // not this conductor's trip
    await phone.post(`${url}/end`).expect(200);
    await phone.post(`${url}/start`).expect(409);
  });

  it("shows the passenger's own stop with distance and time, and switches to the dropping point once on board", async () => {
    const { trip, phone } = await journey(ids.operatorId, 0.5, "KRSTOP12");
    // Stop positions are looked up once and kept; here they are already known.
    await prisma.geoPlace.createMany({
      data: [
        { query: "ameerpet, hyderabad, india", latitude: 17.4375, longitude: 78.4483 },
        { query: "majestic, bengaluru krstop12, india", latitude: 12.9767, longitude: 77.5713 },
      ],
    });
    const link = (await lookup({ pnr: "KRSTOP12" }).expect(200)).body;
    // Before the bus reports, the stop is known but not how far the bus is.
    expect(link.stop).toMatchObject({ kind: "BOARDING", name: "Ameerpet", latitude: 17.4375, distanceKm: null, etaMinutes: null });

    await phone.post(`/api/v1/conductor/trips/${trip.id}/location`).send(fix).expect(201);
    const seen = (await location(link.token).expect(200)).body.stop;
    // About 7 km in a straight line from the bus to Ameerpet, plus 30% for roads.
    expect(seen.distanceKm).toBeGreaterThan(8);
    expect(seen.distanceKm).toBeLessThan(11);
    expect(seen.etaMinutes).toBeGreaterThan(10);
    expect(seen.etaMinutes).toBeLessThan(30);

    await prisma.passenger.create({
      data: { operatorId: ids.operatorId, bookingId: (await prisma.booking.findFirstOrThrow({ where: { pnr: "KRSTOP12" } })).id, name: "Ramesh", phoneEnc: "x", phoneHash: "x", boarded: true },
    });
    expect((await location(link.token).expect(200)).body.stop).toMatchObject({ kind: "DROPPING", name: "Majestic" });

    // A stop whose name is not on the map simply is not shown.
    await prisma.geoPlace.deleteMany();
    expect((await location(link.token).expect(200)).body.stop).toBeNull();
  });

  it("keeps each kind of token to its own job", async () => {
    const { trip, conductor, phone } = await journey(ids.operatorId, 0.5, "KRTOKEN1");
    const link = (await lookup({ pnr: "KRTOKEN1" }).expect(200)).body.token as string;
    const key = (await phone.post(`/api/v1/conductor/trips/${trip.id}/gps-key`).expect(200)).body.token as string;
    const post = (token: string) => request(app).post("/api/v1/tracking/fix").set("Authorization", `Bearer ${token}`).send(fix);

    await request(app).get("/api/v1/tracking/location").expect(401);
    await location(key).expect(401); // a phone key is not a passenger link
    await post(link).expect(401); // a passenger cannot move the bus
    await location("not.a.token").expect(401);
    // Neither is a sign-in.
    for (const token of [link, key]) {
      await request(app).get("/api/v1/conductor/trips").set("Authorization", `Bearer ${token}`).expect(401);
      await request(app).get("/api/v1/bookings").set("Authorization", `Bearer ${token}`).expect(401);
    }
    // A conductor the owner has disabled can no longer report, even with a key issued earlier.
    await prisma.conductor.update({ where: { id: conductor.id }, data: { isActive: false } });
    await post(key).expect(404);
  });
});
