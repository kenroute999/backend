import bcrypt from "bcrypt";
import request from "supertest";
import { app } from "../../app";
import { prisma } from "../../core/db";
import { as, cleanDb, OWNER_EMAIL, OWNER_PASSWORD, seedOwner } from "../../test/helpers";

let ids: { operatorId: string; userId: string };
const hash = (password: string) => bcrypt.hash(password, 4);

const login = (body: Record<string, string>) => request(app).post("/api/v1/auth/login").send(body);
const refresh = (refreshToken: string) => request(app).post("/api/v1/auth/refresh").send({ refreshToken });

async function addAgent(isActive = true) {
  return prisma.agent.create({
    data: {
      operatorId: ids.operatorId,
      name: "Anil Agent",
      phone: "9988776655",
      email: "anil@example.com",
      passwordHash: await hash("Agent@123"),
      agentCode: "AGT1024",
      commissionPct: 10,
      isActive,
    },
  });
}

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("login", () => {
  it("signs an owner in by email and returns tokens and the user, never the hash", async () => {
    const res = await login({ email: "  Owner@Example.com ", password: OWNER_PASSWORD }).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      id: ids.userId,
      email: OWNER_EMAIL,
      role: "OWNER",
      operatorId: ids.operatorId,
      operatorName: "Sri Krishna Travels",
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    expect(String(res.headers["set-cookie"])).toMatch(/kr_refresh=.*HttpOnly/);

    // Only the hash of the refresh token is stored.
    const stored = await prisma.refreshToken.findMany();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.tokenHash).not.toBe(res.body.refreshToken);
  });

  it("signs an agent in by email and a conductor in by mobile number", async () => {
    await addAgent();
    await prisma.conductor.create({
      data: { operatorId: ids.operatorId, name: "Rakesh", phone: "7418529630", passwordHash: await hash("Cond@1234") },
    });

    const agent = await login({ email: "anil@example.com", password: "Agent@123" }).expect(200);
    expect(agent.body.user).toMatchObject({ role: "AGENT", agentCode: "AGT1024", commissionPct: "10" });

    const conductor = await login({ phone: "7418529630", password: "Cond@1234" }).expect(200);
    expect(conductor.body.user).toMatchObject({ role: "CONDUCTOR", name: "Rakesh", phone: "7418529630" });
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const wrong = await login({ email: OWNER_EMAIL, password: "nope" }).expect(401);
    const unknown = await login({ email: "ghost@example.com", password: "nope" }).expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("refuses a disabled account with 403, but only when the password is right", async () => {
    await addAgent(false);
    await login({ email: "anil@example.com", password: "Agent@123" }).expect(403);
    await login({ email: "anil@example.com", password: "wrong" }).expect(401);
  });

  it("rejects a body with neither or both of email and phone", async () => {
    await login({ password: "x" }).expect(400);
    await login({ email: OWNER_EMAIL, phone: "7418529630", password: "x" }).expect(400);
  });

  it("locks an account out after repeated wrong passwords", async () => {
    for (let i = 0; i < 8; i++) await login({ email: OWNER_EMAIL, password: "nope" }).expect(401);
    const res = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(429);
    expect(res.body.error.code).toBe("RATE_LIMITED");
    // Other accounts are not affected.
    await login({ email: "ghost@example.com", password: "nope" }).expect(401);
  });
});

describe("sessions", () => {
  it("GET /me needs a valid token", async () => {
    const { body } = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const me = await request(app).get("/api/v1/me").set("Authorization", `Bearer ${body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ id: ids.userId, email: OWNER_EMAIL, role: "OWNER" });

    await request(app).get("/api/v1/me").expect(401);
    await request(app).get("/api/v1/me").set("Authorization", "Bearer not-a-token").expect(401);
  });

  it("rotates the refresh token, and replaying an old one ends every session", async () => {
    const first = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const second = await refresh(first.body.refreshToken).expect(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
    expect(second.body.user.role).toBe("OWNER");

    await refresh(first.body.refreshToken).expect(401); // replay of a used token
    await refresh(second.body.refreshToken).expect(401); // so the live one is revoked too
    await refresh("made-up").expect(401);
  });

  it("accepts the refresh token from the cookie as well as the body", async () => {
    const first = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const cookie = String(first.headers["set-cookie"]).split(";")[0]!;
    await request(app).post("/api/v1/auth/refresh").set("Cookie", cookie).expect(200);
  });

  it("logout revokes the refresh token", async () => {
    const { body } = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    await request(app).post("/api/v1/auth/logout").send({ refreshToken: body.refreshToken }).expect(204);
    await refresh(body.refreshToken).expect(401);
  });

  it("changing the password signs out other sessions and the new password works", async () => {
    const { body } = await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(200);
    const client = as("OWNER", ids.userId, ids.operatorId);

    await client.post("/api/v1/auth/change-password").send({ currentPassword: "wrong", newPassword: "Fresh@12345" }).expect(400);
    await client
      .post("/api/v1/auth/change-password")
      .send({ currentPassword: OWNER_PASSWORD, newPassword: "Fresh@12345" })
      .expect(204);

    await refresh(body.refreshToken).expect(401);
    await login({ email: OWNER_EMAIL, password: OWNER_PASSWORD }).expect(401);
    await login({ email: OWNER_EMAIL, password: "Fresh@12345" }).expect(200);
  });

  it("deactivating an agent through the API stops their refresh token working", async () => {
    const agent = await addAgent();
    const { body } = await login({ email: "anil@example.com", password: "Agent@123" }).expect(200);
    await as("OWNER", ids.userId, ids.operatorId).patch(`/api/v1/agents/${agent.id}`).send({ isActive: false }).expect(200);
    await refresh(body.refreshToken).expect(401);
  });
});

describe("access control", () => {
  const ownerOnly = ["/agents", "/drivers", "/conductors", "/buses", "/routes", "/trips"];

  it("refuses every back-office route without a token", async () => {
    for (const path of ownerOnly) await request(app).get(`/api/v1${path}`).expect(401);
  });

  it("refuses agents and conductors on every back-office route", async () => {
    const agent = await addAgent();
    for (const path of ownerOnly) {
      await as("AGENT", agent.id, ids.operatorId).get(`/api/v1${path}`).expect(403);
      await as("CONDUCTOR", agent.id, ids.operatorId).get(`/api/v1${path}`).expect(403);
    }
  });

  it("an owner sees only their own operator's data", async () => {
    await addAgent();
    const other = await seedOwner("Other Travels", "owner@other.example.com");
    const theirs = await as("OWNER", other.userId, other.operatorId).get("/api/v1/agents").expect(200);
    expect(theirs.body.total).toBe(0);
    const ours = await as("OWNER", ids.userId, ids.operatorId).get("/api/v1/agents").expect(200);
    expect(ours.body.total).toBe(1);
  });
});
