-- Hand-written: staff rows move from "User" into their own tables.
-- Set them aside (role as text, so the enum can be rebuilt), then clear them out of "User".
CREATE TEMP TABLE "_staff" AS
SELECT "id", "operatorId", "role"::text AS "role", "name", "email", "phone", "passwordHash",
       "mustChangePassword", "isActive", "agentCode", "commissionPct", "licenseNo",
       "experienceYears", "createdAt", "updatedAt"
FROM "User" WHERE "role"::text <> 'OWNER';

DELETE FROM "User" WHERE "role"::text <> 'OWNER';

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('OWNER', 'AGENT', 'CONDUCTOR');

-- AlterEnum
BEGIN;
CREATE TYPE "Role_new" AS ENUM ('OWNER');
ALTER TABLE "User" ALTER COLUMN "role" TYPE "Role_new" USING ("role"::text::"Role_new");
ALTER TYPE "Role" RENAME TO "Role_old";
ALTER TYPE "Role_new" RENAME TO "Role";
DROP TYPE "public"."Role_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_agentId_fkey";

-- DropForeignKey
ALTER TABLE "CommissionLedger" DROP CONSTRAINT "CommissionLedger_agentId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "Passenger" DROP CONSTRAINT "Passenger_boardedById_fkey";

-- DropForeignKey
ALTER TABLE "Payout" DROP CONSTRAINT "Payout_agentId_fkey";

-- DropForeignKey
ALTER TABLE "RefreshToken" DROP CONSTRAINT "RefreshToken_userId_fkey";

-- DropForeignKey
ALTER TABLE "SupportMessage" DROP CONSTRAINT "SupportMessage_authorId_fkey";

-- DropForeignKey
ALTER TABLE "SupportTicket" DROP CONSTRAINT "SupportTicket_userId_fkey";

-- DropForeignKey
ALTER TABLE "Trip" DROP CONSTRAINT "Trip_conductorId_fkey";

-- DropForeignKey
ALTER TABLE "Trip" DROP CONSTRAINT "Trip_driverId_fkey";

-- DropForeignKey
ALTER TABLE "TripSeat" DROP CONSTRAINT "TripSeat_heldById_fkey";

-- DropIndex
DROP INDEX "Notification_operatorId_userId_createdAt_idx";

-- DropIndex
DROP INDEX "RefreshToken_userId_idx";

-- DropIndex
DROP INDEX "SupportTicket_operatorId_userId_idx";

-- DropIndex
DROP INDEX "User_operatorId_agentCode_key";

-- DropIndex
DROP INDEX "User_operatorId_role_idx";

-- AlterTable
ALTER TABLE "AuditLog" DROP COLUMN "userId",
ADD COLUMN     "actorId" UUID,
ADD COLUMN     "actorType" "AccountType";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "userId",
ADD COLUMN     "recipientId" UUID,
ADD COLUMN     "recipientType" "AccountType";

-- AlterTable
ALTER TABLE "RefreshToken" DROP COLUMN "userId",
ADD COLUMN     "accountId" UUID NOT NULL,
ADD COLUMN     "accountType" "AccountType" NOT NULL;

-- AlterTable
ALTER TABLE "SupportMessage" ADD COLUMN     "authorType" "AccountType" NOT NULL;

-- AlterTable
ALTER TABLE "SupportTicket" DROP COLUMN "userId",
ADD COLUMN     "agentId" UUID NOT NULL;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "agentCode",
DROP COLUMN "commissionPct",
DROP COLUMN "experienceYears",
DROP COLUMN "licenseNo",
ALTER COLUMN "role" SET DEFAULT 'OWNER',
ALTER COLUMN "email" SET NOT NULL,
ALTER COLUMN "passwordHash" SET NOT NULL;

-- CreateTable
CREATE TABLE "Agent" (
    "id" UUID NOT NULL,
    "operatorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "agentCode" TEXT NOT NULL,
    "commissionPct" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conductor" (
    "id" UUID NOT NULL,
    "operatorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conductor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" UUID NOT NULL,
    "operatorId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNo" TEXT NOT NULL,
    "experienceYears" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agent_email_key" ON "Agent"("email");

-- CreateIndex
CREATE INDEX "Agent_operatorId_idx" ON "Agent"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Agent_operatorId_agentCode_key" ON "Agent"("operatorId", "agentCode");

-- CreateIndex
CREATE UNIQUE INDEX "Conductor_email_key" ON "Conductor"("email");

-- CreateIndex
CREATE INDEX "Conductor_operatorId_idx" ON "Conductor"("operatorId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_operatorId_licenseNo_key" ON "Driver"("operatorId", "licenseNo");

-- CreateIndex
CREATE INDEX "Notification_operatorId_recipientType_recipientId_createdAt_idx" ON "Notification"("operatorId", "recipientType", "recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "RefreshToken_accountType_accountId_idx" ON "RefreshToken"("accountType", "accountId");

-- CreateIndex
CREATE INDEX "SupportTicket_operatorId_agentId_idx" ON "SupportTicket"("operatorId", "agentId");

-- CreateIndex
CREATE INDEX "User_operatorId_idx" ON "User"("operatorId");

-- AddForeignKey
ALTER TABLE "Agent" ADD CONSTRAINT "Agent_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conductor" ADD CONSTRAINT "Conductor_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_conductorId_fkey" FOREIGN KEY ("conductorId") REFERENCES "Conductor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripSeat" ADD CONSTRAINT "TripSeat_heldById_fkey" FOREIGN KEY ("heldById") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passenger" ADD CONSTRAINT "Passenger_boardedById_fkey" FOREIGN KEY ("boardedById") REFERENCES "Conductor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLedger" ADD CONSTRAINT "CommissionLedger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written: copy the staff into the new tables, keeping their ids and password hashes.
INSERT INTO "Agent" ("id", "operatorId", "name", "phone", "email", "passwordHash", "mustChangePassword", "isActive", "agentCode", "commissionPct", "createdAt", "updatedAt")
SELECT "id", "operatorId", "name", "phone", "email", "passwordHash", "mustChangePassword", "isActive", "agentCode", "commissionPct", "createdAt", "updatedAt"
FROM "_staff"
WHERE "role" = 'AGENT' AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL AND "phone" IS NOT NULL
  AND "agentCode" IS NOT NULL AND "commissionPct" IS NOT NULL;

INSERT INTO "Conductor" ("id", "operatorId", "name", "phone", "email", "passwordHash", "mustChangePassword", "isActive", "createdAt", "updatedAt")
SELECT "id", "operatorId", "name", "phone", "email", "passwordHash", "mustChangePassword", "isActive", "createdAt", "updatedAt"
FROM "_staff"
WHERE "role" = 'CONDUCTOR' AND "email" IS NOT NULL AND "passwordHash" IS NOT NULL AND "phone" IS NOT NULL;

INSERT INTO "Driver" ("id", "operatorId", "name", "phone", "licenseNo", "experienceYears", "isActive", "createdAt", "updatedAt")
SELECT "id", "operatorId", "name", "phone", "licenseNo", COALESCE("experienceYears", 0), "isActive", "createdAt", "updatedAt"
FROM "_staff"
WHERE "role" = 'DRIVER' AND "phone" IS NOT NULL AND "licenseNo" IS NOT NULL;

DROP TABLE "_staff";
