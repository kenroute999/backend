import jwt from "jsonwebtoken";
import request from "supertest";
import { app } from "../app";
import { signAccessToken } from "../core/auth";
import { config } from "../core/config";
import { decrypt } from "../core/crypto";
import { prisma } from "../core/db";
import { createTripWithSeats } from "../modules/trips/service";
import { layoutFor } from "../modules/buses/layouts";
import { OWNER_EMAIL, OWNER_PASSWORD, as, cleanDb, seedOwner } from "./helpers";

// What someone poking at the API with a proxy tool would try first.

let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);

const agent = (email: string, code: string, operatorId = ids.operatorId) =>
  prisma.agent.create({
    data: { operatorId, name: "Anil", phone: "9988776655", email, passwordHash: "x", agentCode: code, commissionPct: 10 },
  });

async function trip(operatorId = ids.operatorId) {
  const layout = await layoutFor(operatorId, "SEATER");
  const bus = await prisma.bus.create({
    data: { operatorId, registrationNo: `TS 09 ZZ ${Math.floor(1000 + Math.random() * 8999)}`, seating: "SEATER", seatLayoutId: layout.id },
  });
  const route = await prisma.route.create({ data: { operatorId, origin: "Hyderabad", destination: "Bangalore", baseFare: 900 } });
  const made = await createTripWithSeats(operatorId, {
    busId: bus.id,
    routeId: route.id,
    departureAt: new Date(Date.now() + 86_400_000),
    arrivalAt: new Date(Date.now() + 2 * 86_400_000),
    fare: 900,
  });
  const seats = await prisma.tripSeat.findMany({ where: { tripId: made.id }, orderBy: { seatNumber: "asc" } });
  return { id: made.id, seats };
}

const person = (seatId: string, over: Record<string, unknown> = {}) => ({
  seatId,
  name: "Ramesh Kumar",
  age: 30,
  gender: "MALE",
  phone: "9876543210",
  idProofType: "AADHAAR",
  idProofNumber: "123456789012",
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

describe("one seat, two buyers", () => {
  it("lets exactly one of many simultaneous bookings for the same seat through, agents and owner alike", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const b = await agent("babu@example.com", "AGT2");
    const t = await trip();
    const seat = t.seats[20]!.id; // a single seat, so the neighbour rule plays no part

    const attempts = await Promise.all([
      ...Array.from({ length: 4 }, () => as("AGENT", a.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(t.id, [person(seat)]))),
      ...Array.from({ length: 4 }, () => as("AGENT", b.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(t.id, [person(seat)]))),
      ...Array.from({ length: 2 }, () => owner().post("/api/v1/bookings").send(order(t.id, [person(seat)], { source: "COUNTER" }))),
    ]);
    const codes = attempts.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);

    expect(await prisma.booking.count({ where: { tripSeatId: seat, status: "CONFIRMED" } })).toBe(1);
    expect(await prisma.passenger.count()).toBe(1);
    expect(await prisma.commissionLedger.count()).toBeLessThanOrEqual(1);
  });
});

describe("tampering", () => {
  it("treats injection strings as plain text or rejects them; the tables are untouched", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    const t = await trip();
    const evil = "'; DROP TABLE \"Booking\"; --";

    await request(app).post("/api/v1/auth/login").send({ email: `${evil}@x.com`, password: evil }).expect((r) => expect([400, 401]).toContain(r.status));
    await request(app).post("/api/v1/auth/login").send({ email: { $ne: null }, password: { $gt: "" } }).expect(400);
    await desk.get(`/api/v1/booking/trips/${encodeURIComponent(evil)}/seats`).expect(400);
    await desk.get(`/api/v1/booking/bookings?since=${encodeURIComponent(evil)}`).expect(400);
    await owner().get(`/api/v1/reports/summary?from=${encodeURIComponent("2026-01-01' OR '1'='1")}`).expect(400);
    // Names accept letters only, so script tags and spreadsheet formulas never get stored.
    await desk.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id, { name: "<script>alert(1)</script>" })])).expect(400);
    await desk.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id, { name: "=HYPERLINK(\"http://x\")" })])).expect(400);
    // Free text is stored exactly as typed (the screens escape it when showing it).
    const made = await desk
      .post("/api/v1/support/tickets")
      .send({ subject: `<img src=x onerror=alert(1)> ${evil}`, category: "Booking Issues", description: evil })
      .expect(201);
    expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: made.body.id } })).subject).toContain("<img");

    expect(await prisma.booking.count()).toBe(0);
    expect(await prisma.tripSeat.count()).toBeGreaterThan(0);
  });

  it("ignores extra fields: a buyer cannot set the price, the agent, the operator or the status", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    const t = await trip();
    for (const extra of [{ fare: 1 }, { agentId: ids.userId }, { operatorId: ids.userId }, { status: "COMPLETED" }, { pnr: "KRFREE00" }]) {
      await desk.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id)], extra)).expect(400);
    }
    await desk.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id, { fare: 1 })])).expect(400);
    await owner().patch(`/api/v1/agents/${a.id}`).send({ operatorId: ids.userId }).expect(400);
    await owner().patch(`/api/v1/agents/${a.id}`).send({ passwordHash: "x" }).expect(400);
    expect(await prisma.booking.count()).toBe(0);
  });

  it("keeps operators apart: another operator's ids look like they do not exist", async () => {
    const mine = await agent("anil@example.com", "AGT1");
    const t = await trip();
    const sold = await as("AGENT", mine.id, ids.operatorId).post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id)])).expect(201);

    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const theirOwner = as("OWNER", other.userId, other.operatorId);
    const theirAgent = await agent("spy@example.com", "SPY1", other.operatorId);
    const spy = as("AGENT", theirAgent.id, other.operatorId);

    await spy.get(`/api/v1/booking/trips/${t.id}/seats`).expect(404);
    await spy.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[1]!.id)])).expect(404);
    await spy.post(`/api/v1/booking/bookings/${sold.body.bookings[0].id}/cancel`).expect(404);
    await theirOwner.get(`/api/v1/schedules/${t.id}/seats`).expect(404);
    await theirOwner.patch(`/api/v1/schedules/${t.id}/seats/${t.seats[2]!.id}`).send({ blocked: true }).expect(409);
    await theirOwner.patch(`/api/v1/agents/${mine.id}`).send({ isActive: false }).expect(404);
    await theirOwner.delete(`/api/v1/agents/${mine.id}`).expect(404);
    await theirOwner.post(`/api/v1/bookings/${sold.body.bookings[0].id}/cancel`).expect(404);
    expect((await theirOwner.get("/api/v1/bookings").expect(200)).body.total).toBe(0);
    expect((await theirOwner.get("/api/v1/reports/summary").expect(200)).body.totals.bookings).toBe(0);
    // A token cannot be pointed at another operator either: the account is not in that operator.
    await as("OWNER", other.userId, ids.operatorId).get("/api/v1/bookings").expect(401);
  });

  it("keeps roles apart, and refuses forged, unsigned and missing tokens", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    for (const path of ["/agents", "/drivers", "/conductors", "/buses", "/schedules", "/bookings", "/reports/summary"]) {
      await desk.get(`/api/v1${path}`).expect(403);
    }
    await desk.get("/api/v1/conductor/trips").expect(403);
    await owner().get("/api/v1/conductor/trips").expect(403);

    await request(app).get("/api/v1/bookings").expect(401);
    await request(app).get("/api/v1/bookings").set("Authorization", "Bearer not.a.token").expect(401);
    // "alg: none" token claiming to be the owner.
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "none", typ: "JWT" })}.${b64({ userId: ids.userId, operatorId: ids.operatorId, role: "OWNER" })}.`;
    await request(app).get("/api/v1/bookings").set("Authorization", `Bearer ${unsigned}`).expect(401);
  });

  it("cuts off an account the moment it is disabled or deleted, even with a token still in date", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    await desk.get("/api/v1/booking/routes").expect(200);
    await owner().patch(`/api/v1/agents/${a.id}`).send({ isActive: false }).expect(200);
    await desk.get("/api/v1/booking/routes").expect(401);
    await desk.get("/api/v1/booking/bookings").expect(401);
    await owner().delete(`/api/v1/agents/${a.id}`).expect(204);
    await desk.get("/api/v1/support/tickets").expect(401);
  });
});

describe("what the server gives away", () => {
  it("sends protective headers, hides what it runs on, and never leaks internals in errors", async () => {
    const res = await request(app).get("/api/v1/health").expect(200);
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers).toMatchObject({
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });

    const big = await owner().post("/api/v1/buses").send({ name: "x".repeat(200_000) }).expect(413);
    expect(big.body.error.code).toBe("TOO_LARGE");
    const broken = await owner().post("/api/v1/buses").set("Content-Type", "application/json").send('{"name": ').expect(400);
    for (const body of [big.body, broken.body, (await request(app).get("/api/v1/nope").expect(404)).body]) {
      expect(JSON.stringify(body)).not.toMatch(/prisma|node_modules|at .*\(|stack|postgres|SELECT/i);
    }
    // An unknown origin gets no permission to read answers from a browser.
    const cross = await request(app).get("/api/v1/health").set("Origin", "https://evil.example");
    expect(cross.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("never returns password hashes, token hashes, encrypted fields or ID proof numbers", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    const t = await trip();
    await desk.post("/api/v1/booking/bookings").send(order(t.id, [person(t.seats[0]!.id)])).expect(201);
    const pages = await Promise.all([
      owner().get("/api/v1/agents"),
      owner().get("/api/v1/conductors"),
      owner().get("/api/v1/bookings"),
      owner().get(`/api/v1/schedules/${t.id}/seats`),
      owner().get("/api/v1/reports/summary"),
      owner().get("/api/v1/me"),
      desk.get("/api/v1/booking/bookings"),
      desk.get(`/api/v1/booking/trips/${t.id}/seats`),
      desk.get("/api/v1/me"),
    ]);
    for (const page of pages) {
      expect(page.status).toBe(200);
      expect(JSON.stringify(page.body)).not.toMatch(/passwordHash|tokenHash|phoneEnc|idProofEnc|phoneHash|123456789012/);
    }
    // The agent's seat map shows no passenger names or phones of other people.
    expect(JSON.stringify(pages[7]!.body)).not.toMatch(/Ramesh|9876543210/);
  });
});

describe("token attacks", () => {
  const paths = ["/me", "/agents", "/bookings", "/reports/summary", "/schedules", "/booking/routes", "/booking/bookings", "/support/tickets", "/conductor/trips"];

  it("refuses every altered token on every protected address, so faking a signed-in screen shows no data", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const good = signAccessToken({ userId: a.id, operatorId: ids.operatorId, role: "AGENT" });
    const [head, body, sig] = good.split(".") as [string, string, string];
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const claims = { userId: ids.userId, operatorId: ids.operatorId, role: "OWNER" };

    const forged = {
      "role changed, old signature kept": `${head}.${b64({ ...JSON.parse(Buffer.from(body, "base64url").toString()), role: "OWNER" })}.${sig}`,
      "signed with a guessed secret": jwt.sign(claims, "secret", { algorithm: "HS256" }),
      "signed with an empty secret": `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.${Buffer.from("").toString("base64url")}`,
      "no signature (alg none)": `${b64({ alg: "none", typ: "JWT" })}.${b64(claims)}.`,
      "expired": jwt.sign(claims, config.jwtAccessSecret, { algorithm: "HS256", expiresIn: -10 }),
      "stronger-looking algorithm": jwt.sign(claims, config.jwtAccessSecret, { algorithm: "HS512" }),
      "made-up role": jwt.sign({ ...claims, role: "SUPERADMIN" }, config.jwtAccessSecret, { algorithm: "HS256" }),
      "account that does not exist": jwt.sign({ ...claims, userId: "11111111-1111-4111-8111-111111111111" }, config.jwtAccessSecret, { algorithm: "HS256" }),
      "random text": "true",
    };
    for (const [what, token] of Object.entries(forged)) {
      for (const path of paths) {
        const res = await request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${token}`);
        if (res.status !== 401 && res.status !== 403) throw new Error(`${what} was accepted on ${path} (${res.status})`);
        expect(JSON.stringify(res.body)).not.toMatch(/Ramesh|9876543210|agentCode/);
      }
    }
    // The untouched token still works, so the checks above are not just rejecting everything.
    await request(app).get("/api/v1/booking/routes").set("Authorization", `Bearer ${good}`).expect(200);
  });

  it("a used or made-up refresh token gets nothing, and reusing one ends every session", async () => {
    const login = await request(app).post("/api/v1/auth/login").send({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const first = login.body.refreshToken;
    const next = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first }).expect(200);
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: "made-up-token" }).expect(401);
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: first }).expect(401); // replayed
    await request(app).post("/api/v1/auth/refresh").send({ refreshToken: next.body.refreshToken }).expect(401); // all ended
  });
});

describe("encryption of passenger details", () => {
  it("stores phone and ID proof unreadable, differently each time, and refuses altered data", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const t = await trip();
    await as("AGENT", a.id, ids.operatorId)
      .post("/api/v1/booking/bookings")
      .send(order(t.id, [person(t.seats[0]!.id), person(t.seats[20]!.id)]))
      .expect(201);

    const [one, two] = await prisma.passenger.findMany();
    for (const p of [one!, two!]) {
      expect(`${p.phoneEnc}${p.idProofEnc}${p.phoneHash}`).not.toMatch(/9876543210|123456789012/);
      expect(decrypt(p.phoneEnc)).toBe("9876543210");
      expect(decrypt(p.idProofEnc!)).toBe("123456789012");
    }
    // Same phone, different stored text each time; the search hash is the same.
    expect(one!.phoneEnc).not.toBe(two!.phoneEnc);
    expect(one!.phoneHash).toBe(two!.phoneHash);
    // Flip one character of the stored text: it must fail, not decrypt to something else.
    const stored = one!.phoneEnc;
    const flipped = stored.slice(0, -2) + (stored.endsWith("A") ? "B" : "A") + stored.slice(-1);
    expect(() => decrypt(flipped)).toThrow();
  });
});
