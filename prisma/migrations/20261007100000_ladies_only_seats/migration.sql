-- The owner can keep a seat on a trip for women only.
ALTER TABLE "TripSeat" ADD COLUMN "ladiesOnly" BOOLEAN NOT NULL DEFAULT false;
