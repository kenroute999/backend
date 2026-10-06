import bcrypt from "bcrypt";
import { prisma } from "../src/core/db";
import { createTripWithSeats } from "../src/modules/trips/service";

// Safe to run repeatedly: existing rows are left alone.
const OPERATOR = "Sri Krishna Travels";
const AGENT_PASSWORD = "Agent@123";
const OWNER = { name: "Sri Krishna Owner", email: "owner@srikrishna.test", password: "Owner@123" };

const agents = [
  { name: "Ravi Travels", phone: "9988776655", email: "ravi@example.com", commissionPct: 8, agentCode: "AGT1001", isActive: true },
  { name: "Sai Tour & Travels", phone: "9123456780", email: "sai@example.com", commissionPct: 10, agentCode: "AGT1002", isActive: true },
  { name: "Prasad Tours", phone: "9900112233", email: "prasad@example.com", commissionPct: 8, agentCode: "AGT1003", isActive: true },
  { name: "Balaji Travels", phone: "9345678901", email: "balaji@example.com", commissionPct: 12, agentCode: "AGT1004", isActive: false },
];

const drivers = [
  { name: "Ramesh Kumar", licenseNo: "TS-DL-2018-23145", phone: "9876543210", experienceYears: 8, isActive: true },
  { name: "Suresh Babu", licenseNo: "TS-DL-2016-19872", phone: "9876543211", experienceYears: 10, isActive: true },
  { name: "Mahesh Reddy", licenseNo: "AP-DL-2019-44521", phone: "9876543212", experienceYears: 6, isActive: false },
  { name: "Venkat Rao", licenseNo: "TS-DL-2014-11234", phone: "9876543213", experienceYears: 12, isActive: true },
];

// Same fleet the Admin screens show today, so pickers have real rows to offer.
const buses = [
  { registrationNo: "TS 09 AB 1234", name: "KenRoute Volvo", seating: "SLEEPER", isAc: true, seats: 40, status: "ACTIVE" },
  { registrationNo: "TS 09 CD 5678", name: "KenRoute Scania", seating: "SEATER", isAc: true, seats: 45, status: "ACTIVE" },
  { registrationNo: "TS 09 EF 9101", name: "KenRoute Benz", seating: "SLEEPER", isAc: false, seats: 36, status: "MAINTENANCE" },
  { registrationNo: "TS 09 GH 1122", name: "KenRoute Starz", seating: "SEATER_SLEEPER", isAc: true, seats: 50, status: "ACTIVE" },
  { registrationNo: "TS 09 IJ 3344", name: "KenRoute Deluxe", seating: "SEATER", isAc: true, seats: 40, status: "INACTIVE" },
] as const;

const routes = [
  { origin: "Hyderabad", destination: "Bangalore", baseFare: 1200 },
  { origin: "Hyderabad", destination: "Vijayawada", baseFare: 850 },
  { origin: "Bangalore", destination: "Chennai", baseFare: 1100 },
  { origin: "Hyderabad", destination: "Chennai", baseFare: 1000 },
  { origin: "Visakhapatnam", destination: "Hyderabad", baseFare: 950 },
  { origin: "Hyderabad", destination: "Tirupati", baseFare: 900 },
];

// Daily departures for the next week, matching the times on the Admin Routes screen. Times are IST.
const DAYS_AHEAD = 7;
const schedule = [
  { bus: "TS 09 AB 1234", origin: "Hyderabad", destination: "Bangalore", depart: "20:00", hours: 9.5 },
  { bus: "TS 09 CD 5678", origin: "Hyderabad", destination: "Vijayawada", depart: "06:00", hours: 5.25 },
  { bus: "TS 09 GH 1122", origin: "Bangalore", destination: "Chennai", depart: "19:00", hours: 7.25 },
];

/** The calendar day in India, `offset` days from today, as YYYY-MM-DD. */
function istDay(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// Placeholder grid, four across on one deck. Real layouts come from the seat-layout designer.
function gridSeats(count: number, type: string) {
  return Array.from({ length: count }, (_, i) => ({
    number: String(i + 1),
    deck: "LOWER",
    row: Math.floor(i / 4),
    col: i % 4,
    type,
    ladiesOnly: false,
  }));
}

async function main() {
  const operator =
    (await prisma.operator.findFirst({ where: { name: OPERATOR } })) ??
    (await prisma.operator.create({ data: { name: OPERATOR } }));
  const operatorId = operator.id;
  const passwordHash = await bcrypt.hash(AGENT_PASSWORD, 10);

  if (!(await prisma.user.findUnique({ where: { email: OWNER.email } }))) {
    await prisma.user.create({
      data: {
        operatorId,
        name: OWNER.name,
        email: OWNER.email,
        passwordHash: await bcrypt.hash(OWNER.password, 10),
        mustChangePassword: false,
      },
    });
  }
  for (const a of agents) {
    if (await prisma.agent.findUnique({ where: { email: a.email } })) continue;
    await prisma.agent.create({ data: { ...a, operatorId, passwordHash } });
  }
  for (const d of drivers) {
    if (await prisma.driver.findFirst({ where: { operatorId, licenseNo: d.licenseNo } })) continue;
    await prisma.driver.create({ data: { ...d, operatorId } });
  }
  for (const { seats, ...b } of buses) {
    if (await prisma.bus.findFirst({ where: { operatorId, registrationNo: b.registrationNo } })) continue;
    const name = `${b.seating} ${seats}`;
    const layout =
      (await prisma.seatLayout.findFirst({ where: { operatorId, name } })) ??
      (await prisma.seatLayout.create({
        data: { operatorId, name, totalSeats: seats, seats: gridSeats(seats, b.seating === "SEATER" ? "SEATER" : "SLEEPER") },
      }));
    await prisma.bus.create({ data: { ...b, operatorId, seatLayoutId: layout.id } });
  }
  for (const r of routes) {
    if (await prisma.route.findFirst({ where: { operatorId, origin: r.origin, destination: r.destination } })) continue;
    await prisma.route.create({ data: { ...r, operatorId } });
  }

  for (const s of schedule) {
    const bus = await prisma.bus.findFirstOrThrow({ where: { operatorId, registrationNo: s.bus } });
    const route = await prisma.route.findFirstOrThrow({
      where: { operatorId, origin: s.origin, destination: s.destination },
    });
    for (let day = 0; day < DAYS_AHEAD; day++) {
      const departureAt = new Date(`${istDay(day)}T${s.depart}:00+05:30`);
      if (departureAt <= new Date()) continue;
      if (await prisma.trip.findFirst({ where: { operatorId, busId: bus.id, departureAt } })) continue;
      await createTripWithSeats(operatorId, {
        busId: bus.id,
        routeId: route.id,
        departureAt,
        arrivalAt: new Date(departureAt.getTime() + s.hours * 3_600_000),
      });
    }
  }

  const where = { operatorId };
  const [agentCount, driverCount, busCount, routeCount, tripCount] = await Promise.all([
    prisma.agent.count({ where }),
    prisma.driver.count({ where }),
    prisma.bus.count({ where }),
    prisma.route.count({ where }),
    prisma.trip.count({ where }),
  ]);
  console.log(
    `Seeded "${OPERATOR}": ${agentCount} agents, ${driverCount} drivers, ${busCount} buses, ${routeCount} routes, ${tripCount} trips`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
