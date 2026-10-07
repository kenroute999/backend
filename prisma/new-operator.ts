import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "../src/core/db";

// Adds one new bus company (an "operator") with its owner login, and nothing else:
// no buses, routes, agents or bookings. The owner builds everything from the Admin app.
//
//   npm run new-operator -- "Company Name" owner@company.com "Owner Name"
//
// The password is made up here and shown once. Only its hash is stored.

async function main() {
  const [company, emailArg, ownerName = "Owner"] = process.argv.slice(2);
  const email = emailArg?.trim().toLowerCase();
  if (!company || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Usage: npm run new-operator -- "Company Name" owner@company.com "Owner Name"');
  }
  // One login email belongs to one account, whether owner or agent.
  if ((await prisma.user.findUnique({ where: { email } })) || (await prisma.agent.findUnique({ where: { email } }))) {
    throw new Error(`${email} is already used by another account`);
  }

  // 12 characters with upper, lower, digit and symbol, so it passes the password rule.
  const password = `${crypto.randomBytes(6).toString("base64url")}aB3@`;
  const operator = await prisma.operator.create({
    data: {
      name: company,
      users: { create: { name: ownerName, email, passwordHash: await bcrypt.hash(password, 10), mustChangePassword: false } },
    },
  });

  console.log(`Created operator "${operator.name}"`);
  console.log(`  Admin login: ${email}`);
  console.log(`  Password:    ${password}   (shown once; change it after signing in)`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
