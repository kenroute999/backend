import bcrypt from "bcrypt";
import request from "supertest";
import { app } from "../app";
import { signAccessToken, type Role } from "../core/auth";
import { prisma } from "../core/db";
import { resetLoginLimits } from "../modules/auth/routes";

export const OWNER_EMAIL = "owner@example.com";
export const OWNER_PASSWORD = "Owner@123";

/** Empties every table the tests write to, children first. */
export async function cleanDb() {
  await prisma.refreshToken.deleteMany();
  await prisma.geoPlace.deleteMany();
  await prisma.supportTicket.deleteMany(); // its messages go with it
  await prisma.commissionLedger.deleteMany();
  await prisma.passenger.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.channel.deleteMany();
  await prisma.trip.deleteMany();
  await prisma.conductor.deleteMany();
  await prisma.bus.deleteMany();
  await prisma.seatLayout.deleteMany();
  await prisma.route.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.user.deleteMany();
  await prisma.operator.deleteMany();
  resetLoginLimits();
}

/** A fresh operator with one owner account. */
export async function seedOwner(name = "Sri Krishna Travels", email = OWNER_EMAIL) {
  const operator = await prisma.operator.create({ data: { name } });
  const user = await prisma.user.create({
    data: {
      operatorId: operator.id,
      name: "Owner",
      email,
      // Low cost keeps the suite fast; production hashes use cost 10.
      passwordHash: await bcrypt.hash(OWNER_PASSWORD, 4),
      mustChangePassword: false,
    },
  });
  return { operatorId: operator.id, userId: user.id };
}

/** A supertest client that sends a valid access token for the given account. */
export function as(role: Role, userId: string, operatorId: string) {
  const token = signAccessToken({ userId, operatorId, role });
  return request.agent(app).set("Authorization", `Bearer ${token}`);
}
