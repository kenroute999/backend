import { prisma } from "../../core/db";
import { as, cleanDb, seedOwner } from "../../test/helpers";

let ids: { operatorId: string; userId: string };

const agent = (email: string, code: string) =>
  prisma.agent.create({
    data: { operatorId: ids.operatorId, name: "Anil", phone: "9988776655", email, passwordHash: "x", agentCode: code, commissionPct: 10 },
  });

const ticket = {
  subject: "Cannot print ticket",
  category: "Ticket Problems",
  priority: "HIGH",
  pnr: "krab12cd",
  description: "The print button opens an empty page.",
};

beforeEach(async () => {
  await cleanDb();
  ids = await seedOwner();
});

afterAll(() => prisma.$disconnect());

describe("support tickets", () => {
  it("saves the ticket with its description, lists it to its agent only, and reports that no email is set up", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const b = await agent("babu@example.com", "AGT2");
    const desk = as("AGENT", a.id, ids.operatorId);

    const made = await desk.post("/api/v1/support/tickets").send(ticket).expect(201);
    expect(made.body).toMatchObject({ subject: "Cannot print ticket", priority: "HIGH", status: "OPEN", pnr: "KRAB12CD", emailed: false });
    expect(made.body.ticketNo).toMatch(/^SUP[0-9A-F]{6}$/);
    const saved = await prisma.supportMessage.findFirstOrThrow({ where: { ticketId: made.body.id } });
    expect(saved).toMatchObject({ authorType: "AGENT", authorId: a.id, body: ticket.description });

    expect((await desk.get("/api/v1/support/tickets").expect(200)).body.items).toHaveLength(1);
    expect((await as("AGENT", b.id, ids.operatorId).get("/api/v1/support/tickets").expect(200)).body.total).toBe(0);
  });

  it("rejects a bad ticket and anyone who is not an agent", async () => {
    const a = await agent("anil@example.com", "AGT1");
    const desk = as("AGENT", a.id, ids.operatorId);
    await desk.post("/api/v1/support/tickets").send({ ...ticket, subject: "x" }).expect(400);
    await desk.post("/api/v1/support/tickets").send({ ...ticket, category: "Other" }).expect(400);
    await desk.post("/api/v1/support/tickets").send({ ...ticket, priority: "URGENT" }).expect(400);
    await as("OWNER", ids.userId, ids.operatorId).post("/api/v1/support/tickets").send(ticket).expect(403);
    expect(await prisma.supportTicket.count()).toBe(0);
  });
});
