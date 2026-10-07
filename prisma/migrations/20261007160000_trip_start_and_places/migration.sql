-- When the conductor pressed "Start trip".
ALTER TABLE "Trip" ADD COLUMN "startedAt" TIMESTAMP(3);

-- Map position of a stop, found once by its name and kept.
CREATE TABLE "GeoPlace" (
    "query" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GeoPlace_pkey" PRIMARY KEY ("query")
);
