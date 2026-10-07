-- The passenger row carries a copy of the journey as booked: seat, bus, route and stops.
-- The booking stays the source of truth; this copy makes the table readable on its own.
ALTER TABLE "Passenger"
  ADD COLUMN "seatNumber" TEXT,
  ADD COLUMN "busNumber" TEXT,
  ADD COLUMN "route" TEXT,
  ADD COLUMN "boardingPoint" TEXT,
  ADD COLUMN "droppingPoint" TEXT;

UPDATE "Passenger" p
SET "seatNumber" = ts."seatNumber",
    "busNumber" = bus."registrationNo",
    "route" = r."origin" || ' → ' || r."destination",
    "boardingPoint" = b."boardingPoint",
    "droppingPoint" = b."droppingPoint"
FROM "Booking" b
JOIN "TripSeat" ts ON ts."id" = b."tripSeatId"
JOIN "Trip" t ON t."id" = b."tripId"
JOIN "Bus" bus ON bus."id" = t."busId"
JOIN "Route" r ON r."id" = t."routeId"
WHERE b."id" = p."bookingId";
