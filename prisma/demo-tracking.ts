import { prisma } from "../src/core/db";
import { createBooking } from "../src/modules/booking/service";
import { saveFix } from "../src/modules/tracking/routes";
import { createTripWithSeats } from "../src/modules/trips/service";

// Shows live tracking without a phone on the road: makes a trip that leaves in 20 minutes,
// sells one ticket on it, prints the PNR, then drives the bus out of Hyderabad for half an
// hour, one position every 10 seconds. For demos on a development database only.
//
//   npm run demo:tracking                      (Sri Krishna Travels)
//   npm run demo:tracking -- owner@company.com

const MINUTE = 60_000;
const START = { latitude: 17.385, longitude: 78.4867 }; // Hyderabad
const END = { latitude: 16.5062, longitude: 80.648 }; // Vijayawada
const STEPS = 180; // 30 minutes

async function main() {
  const email = (process.argv[2] ?? "owner@srikrishna.test").toLowerCase();
  const owner = await prisma.user.findUnique({ where: { email }, select: { operatorId: true } });
  if (!owner) throw new Error(`No owner account ${email}`);
  const operatorId = owner.operatorId;

  const [conductor, route, buses] = await Promise.all([
    prisma.conductor.findFirst({ where: { operatorId, isActive: true } }),
    prisma.route.findFirst({ where: { operatorId } }),
    prisma.bus.findMany({ where: { operatorId, status: "ACTIVE" } }),
  ]);
  if (!conductor || !route) throw new Error("This company needs at least one conductor and one route first");

  // Any bus that is free for the next few hours will do.
  const departureAt = new Date(Date.now() + 20 * MINUTE);
  const arrivalAt = new Date(Date.now() + 6 * 60 * MINUTE);
  let trip;
  for (const bus of buses) {
    try {
      trip = await createTripWithSeats(operatorId, { busId: bus.id, routeId: route.id, departureAt, arrivalAt, conductorId: conductor.id });
      break;
    } catch {
      // busy at that time: try the next one
    }
  }
  if (!trip) throw new Error("No active bus is free right now");

  const seat = await prisma.tripSeat.findFirstOrThrow({ where: { tripId: trip.id, status: "AVAILABLE" }, orderBy: { seatNumber: "asc" } });
  const ticket = await createBooking(
    { operatorId },
    {
      tripId: trip.id,
      source: "COUNTER",
      boardingPoint: route.boardingPoints[0] ?? route.origin,
      droppingPoint: route.droppingPoints[0] ?? route.destination,
      paymentMode: "CASH",
      passengers: [{ seatId: seat.id, name: "Demo Passenger", age: 30, gender: "MALE", phone: "9000000001", idProofType: "AADHAAR", idProofNumber: "0000 0000 0000" }],
    },
  );
  console.log(`\nPNR to track:  ${ticket.pnr}`);
  console.log(`Trip:          ${route.origin} to ${route.destination}, conductor ${conductor.name}`);
  console.log("Open http://127.0.0.1:3004 and enter the PNR. The bus moves for 30 minutes.\n");

  const heading = 113; // roughly south-east
  for (let i = 0; i <= STEPS; i++) {
    // About 250 metres per step, so the movement is easy to see on the map.
    const t = (i * 0.0025) / Math.hypot(END.latitude - START.latitude, END.longitude - START.longitude);
    await saveFix(trip.id, conductor.id, {
      latitude: START.latitude + (END.latitude - START.latitude) * t,
      longitude: START.longitude + (END.longitude - START.longitude) * t,
      accuracy: 10,
      speed: 16.7, // 60 km/h
      heading,
    });
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  console.log("Demo finished. Cancel the demo trip from Admin → Routes if you do not want to keep it.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
