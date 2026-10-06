-- DropIndex
DROP INDEX "Conductor_email_key";

-- AlterTable
ALTER TABLE "Conductor" DROP COLUMN "email",
ADD COLUMN     "busId" UUID,
ADD COLUMN     "routeId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "Conductor_phone_key" ON "Conductor"("phone");

-- AddForeignKey
ALTER TABLE "Conductor" ADD CONSTRAINT "Conductor_busId_fkey" FOREIGN KEY ("busId") REFERENCES "Bus"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conductor" ADD CONSTRAINT "Conductor_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "Route"("id") ON DELETE SET NULL ON UPDATE CASCADE;

