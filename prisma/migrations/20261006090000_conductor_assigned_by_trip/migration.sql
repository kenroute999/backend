-- DropForeignKey
ALTER TABLE "Conductor" DROP CONSTRAINT "Conductor_busId_fkey";

-- DropForeignKey
ALTER TABLE "Conductor" DROP CONSTRAINT "Conductor_routeId_fkey";

-- AlterTable
ALTER TABLE "Conductor" DROP COLUMN "busId",
DROP COLUMN "routeId";

