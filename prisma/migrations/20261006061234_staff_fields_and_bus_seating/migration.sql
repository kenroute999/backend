/*
  Warnings:

  - You are about to drop the column `type` on the `Bus` table. All the data in the column will be lost.
  - Added the required column `seating` to the `Bus` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "SeatingType" AS ENUM ('SLEEPER', 'SEATER', 'SEATER_SLEEPER');

-- AlterTable
ALTER TABLE "Bus" DROP COLUMN "type",
ADD COLUMN     "isAc" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "seating" "SeatingType" NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "experienceYears" INTEGER;

-- DropEnum
DROP TYPE "BusType";
