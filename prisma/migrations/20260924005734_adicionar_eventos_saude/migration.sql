-- CreateEnum
CREATE TYPE "TipoEventoSaude" AS ENUM ('VACINA', 'VERMIFUGO', 'CASTRACAO');

-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_breedId_speciesId_fkey";

-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_locationId_unitId_fkey";

-- CreateTable
CREATE TABLE "HealthEvent" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "tipo" "TipoEventoSaude" NOT NULL,
    "descricao" TEXT,
    "data" TIMESTAMP(3) NOT NULL,
    "observacoes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthEvent_animalId_idx" ON "HealthEvent"("animalId");

-- CreateIndex
CREATE INDEX "HealthEvent_animalId_tipo_idx" ON "HealthEvent"("animalId", "tipo");

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
