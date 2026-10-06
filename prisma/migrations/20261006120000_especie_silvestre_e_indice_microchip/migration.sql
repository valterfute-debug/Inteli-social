-- Sprint 3: espécies silvestres são identificadas pelo nome (regra de admissão)
-- e a busca/unicidade de microchip passa a consultar a coluna com frequência.
-- Aditiva: não altera nem remove dados existentes.

-- AlterTable
ALTER TABLE "Species" ADD COLUMN     "silvestre" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Animal_microchip_idx" ON "Animal"("microchip");
