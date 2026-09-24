-- CreateEnum
CREATE TYPE "SituacaoFoto" AS ENUM ('PENDENTE', 'CONFIRMADA');

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "fotoEntradaId" TEXT,
ADD COLUMN     "observacoes" TEXT;

-- CreateTable
CREATE TABLE "Foto" (
    "id" TEXT NOT NULL,
    "tipoMidia" TEXT NOT NULL,
    "tamanhoBytes" INTEGER NOT NULL,
    "caminhoArmazenamento" TEXT NOT NULL,
    "situacao" "SituacaoFoto" NOT NULL DEFAULT 'PENDENTE',
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Foto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Animal_fotoEntradaId_key" ON "Animal"("fotoEntradaId");

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_fotoEntradaId_fkey" FOREIGN KEY ("fotoEntradaId") REFERENCES "Foto"("id") ON DELETE SET NULL ON UPDATE CASCADE;
