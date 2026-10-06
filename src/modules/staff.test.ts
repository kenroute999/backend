import bcrypt from "bcrypt";
import { prisma } from "../core/db";
import { as, cleanDb, OWNER_EMAIL, seedOwner } from "../test/helpers";

const agent = { name: "Ravi Travels", phone: "9988776655", email: "Ravi@Example.com", password: "Secret@123", commissionPct: 8 };
const driver = { name: "Ramesh Kumar", phone: "9876543210", licenseNo: "ts-dl-2018-23145", experienceYears: 8 };

let ids: { operatorId: string; userId: string };
const owner = () => as("OWNER", ids.userId, ids.operatorId);

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("agents API", () => {
  it("creates an agent, stores only a password hash, never returns it", async () => {
    const res = await owner().post("/api/v1/agents").send(agent).expect(201);
    expect(res.body).toMatchObject({ email: "ravi@example.com", commissionPct: "8", isActive: true });
    expect(res.body.agentCode).toMatch(/^AGT\d{4}$/);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);

    const row = await prisma.agent.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.passwordHash).not.toBe(agent.password);
    expect(await bcrypt.compare(agent.password, row.passwordHash)).toBe(true);
  });

  it("rejects an email already used by another agent or by an owner", async () => {
    await owner().post("/api/v1/agents").send(agent).expect(201);
    const dup = await owner().post("/api/v1/agents").send({ ...agent, name: "Other" }).expect(409);
    expect(dup.body.error.code).toBe("CONFLICT");

    await owner().post("/api/v1/agents").send({ ...agent, email: OWNER_EMAIL }).expect(409);
  });

  it("validates input and names the bad fields", async () => {
    const res = await owner()
      .post("/api/v1/agents")
      .send({ ...agent, phone: "12345", password: "short", commissionPct: 150 })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.error.details).sort()).toEqual(["commissionPct", "password", "phone"]);
  });

  it("lists with search, updates, re-hashes a new password, and deletes", async () => {
    const { body } = await owner().post("/api/v1/agents").send(agent).expect(201);
    const list = await owner().get("/api/v1/agents?search=ravi").expect(200);
    expect(list.body).toMatchObject({ total: 1, page: 1 });
    expect((await owner().get("/api/v1/agents?search=zzz").expect(200)).body.total).toBe(0);

    const res = await owner()
      .patch(`/api/v1/agents/${body.id}`)
      .send({ commissionPct: 12.5, isActive: false, password: "Another@456" })
      .expect(200);
    expect(res.body).toMatchObject({ commissionPct: "12.5", isActive: false });
    const row = await prisma.agent.findUniqueOrThrow({ where: { id: body.id } });
    expect(await bcrypt.compare("Another@456", row.passwordHash)).toBe(true);

    await owner().delete(`/api/v1/agents/${body.id}`).expect(204);
    await owner().delete(`/api/v1/agents/${body.id}`).expect(404);
  });

  it("cannot see, change or delete another operator's agent", async () => {
    const other = await prisma.operator.create({ data: { name: "Other Travels" } });
    const foreign = await prisma.agent.create({
      data: {
        operatorId: other.id,
        name: "Foreign Agent",
        phone: "9000000003",
        email: "foreign@example.com",
        passwordHash: "x",
        agentCode: "AGT0001",
        commissionPct: 5,
      },
    });

    const list = await owner().get("/api/v1/agents").expect(200);
    expect(list.body.items.map((a: { id: string }) => a.id)).not.toContain(foreign.id);
    await owner().patch(`/api/v1/agents/${foreign.id}`).send({ name: "Hacked" }).expect(404);
    await owner().delete(`/api/v1/agents/${foreign.id}`).expect(404);
    expect((await prisma.agent.findUniqueOrThrow({ where: { id: foreign.id } })).name).toBe("Foreign Agent");
  });
});

describe("drivers API", () => {
  it("creates a driver, upper-cases the licence, blocks a duplicate licence", async () => {
    const res = await owner().post("/api/v1/drivers").send(driver).expect(201);
    expect(res.body).toMatchObject({ licenseNo: "TS-DL-2018-23145", experienceYears: 8, isActive: true });
    await owner().post("/api/v1/drivers").send({ ...driver, name: "Someone Else" }).expect(409);
    await owner().post("/api/v1/drivers").send({ ...driver, password: "Secret@123" }).expect(400);
  });

  it("updates and deletes", async () => {
    const { body } = await owner().post("/api/v1/drivers").send(driver).expect(201);
    const res = await owner().patch(`/api/v1/drivers/${body.id}`).send({ experienceYears: 9, isActive: false }).expect(200);
    expect(res.body).toMatchObject({ experienceYears: 9, isActive: false });
    await owner().delete(`/api/v1/drivers/${body.id}`).expect(204);
    expect((await owner().get("/api/v1/drivers").expect(200)).body.total).toBe(0);
  });

  it("cannot see, change or delete another operator's driver", async () => {
    const other = await prisma.operator.create({ data: { name: "Other Travels" } });
    const foreign = await prisma.driver.create({
      data: { operatorId: other.id, name: "Foreign Driver", phone: "9000000004", licenseNo: "XX-1", experienceYears: 1 },
    });
    const list = await owner().get("/api/v1/drivers").expect(200);
    expect(list.body.items.map((d: { id: string }) => d.id)).not.toContain(foreign.id);
    await owner().patch(`/api/v1/drivers/${foreign.id}`).send({ name: "Hacked" }).expect(404);
    await owner().delete(`/api/v1/drivers/${foreign.id}`).expect(404);
  });
});
