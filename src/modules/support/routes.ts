import { Router } from "express";
import { z } from "zod";
import { idParam } from "../../core/accounts";
import { prisma } from "../../core/db";
import { AppError } from "../../core/errors";
import { sendMail, supportEmail } from "../../core/mail";

// An agent's support tickets. Each ticket is saved first; then a copy is emailed to the
// KenRoute support inbox. A ticket is never lost because the email could not be sent.
export const supportRouter = Router();

const CATEGORIES = ["Booking Issues", "Payment Issues", "Ticket Problems", "Route Queries", "Technical Support"] as const;

const ticketInput = z.strictObject({
  subject: z.string().trim().min(3).max(120),
  category: z.enum(CATEGORIES),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  pnr: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{4,20}$/, "Enter a valid PNR")
    .optional(),
  description: z.string().trim().min(1).max(2000),
});

/** "SUP" plus the first six characters of the id: short enough to read out on a call. */
const ticketNo = (id: string) => `SUP${id.slice(0, 6).toUpperCase()}`;

supportRouter.get("/tickets", async (req, res) => {
  const rows = await prisma.supportTicket.findMany({
    where: { operatorId: req.operatorId, agentId: req.auth.userId },
    select: { id: true, subject: true, category: true, priority: true, status: true, pnr: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const items = rows.map((t) => ({ ...t, ticketNo: ticketNo(t.id) }));
  res.json({ items, total: items.length });
});

// The agent closes their own ticket once it is sorted out, or opens it again.
supportRouter.patch("/tickets/:id", async (req, res) => {
  const { id } = idParam.parse(req.params);
  const { status } = z.strictObject({ status: z.enum(["OPEN", "RESOLVED"]) }).parse(req.body);
  const changed = await prisma.supportTicket.updateMany({
    where: { id, operatorId: req.operatorId, agentId: req.auth.userId },
    data: { status },
  });
  if (changed.count === 0) throw new AppError(404, "NOT_FOUND", "Ticket not found");
  res.json({ id, status });
});

supportRouter.post("/tickets", async (req, res) => {
  const input = ticketInput.parse(req.body);
  const agent = await prisma.agent.findFirst({
    where: { id: req.auth.userId, operatorId: req.operatorId },
    select: { id: true, name: true, agentCode: true, email: true, phone: true, operator: { select: { name: true } } },
  });
  if (!agent) throw new AppError(403, "FORBIDDEN", "This account cannot raise a ticket");

  const ticket = await prisma.supportTicket.create({
    data: {
      operatorId: req.operatorId,
      agentId: agent.id,
      subject: input.subject,
      category: input.category,
      priority: input.priority,
      ...(input.pnr && { pnr: input.pnr }),
      messages: { create: { operatorId: req.operatorId, authorType: "AGENT", authorId: agent.id, body: input.description } },
    },
    select: { id: true, subject: true, category: true, priority: true, status: true, pnr: true, createdAt: true },
  });

  const emailed = await sendMail({
    to: supportEmail,
    replyTo: agent.email,
    subject: `[${ticketNo(ticket.id)}] ${input.priority} · ${input.subject}`,
    text: [
      `Ticket:    ${ticketNo(ticket.id)}`,
      `Priority:  ${input.priority}`,
      `Category:  ${input.category}`,
      `PNR:       ${input.pnr ?? "-"}`,
      `Raised:    ${ticket.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`,
      ``,
      `Operator:  ${agent.operator.name}`,
      `Agent:     ${agent.name} (${agent.agentCode})`,
      `Email:     ${agent.email}`,
      `Phone:     ${agent.phone}`,
      ``,
      `Subject:   ${input.subject}`,
      ``,
      input.description,
    ].join("\n"),
  });

  res.status(201).json({ ...ticket, ticketNo: ticketNo(ticket.id), emailed });
});
