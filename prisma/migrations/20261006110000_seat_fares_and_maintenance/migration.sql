-- Each seat carries its own fare, so sleeper and seater berths on one bus can differ.
ALTER TYPE "TripStatus" ADD VALUE 'MAINTENANCE';

ALTER TABLE "Trip" ADD COLUMN "fares" JSONB;

ALTER TABLE "TripSeat" ADD COLUMN "fare" DECIMAL(10,2);
-- Seats that already exist take the single fare their trip was created with.
UPDATE "TripSeat" s SET "fare" = t."fare" FROM "Trip" t WHERE t."id" = s."tripId";
ALTER TABLE "TripSeat" ALTER COLUMN "fare" SET NOT NULL;
