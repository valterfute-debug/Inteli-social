-- Issue #3, P0-2: contas liberadas na API (id = sub do Supabase Auth), papel
-- provisório e unidades em que cada conta pode trabalhar. Foto passa a registrar
-- quem a criou. Aditiva: não altera nem remove dados existentes.

-- CreateEnum
CREATE TYPE "PapelUsuario" AS ENUM ('ADMIN', 'OPERADOR');

-- AlterTable
ALTER TABLE "Foto" ADD COLUMN     "criadoPorId" TEXT;

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "nome" TEXT,
    "papel" "PapelUsuario" NOT NULL DEFAULT 'OPERADOR',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsuarioUnidade" (
    "usuarioId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsuarioUnidade_pkey" PRIMARY KEY ("usuarioId","unitId")
);

-- CreateIndex
CREATE INDEX "UsuarioUnidade_unitId_idx" ON "UsuarioUnidade"("unitId");

-- AddForeignKey
ALTER TABLE "Foto" ADD CONSTRAINT "Foto_criadoPorId_fkey" FOREIGN KEY ("criadoPorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioUnidade" ADD CONSTRAINT "UsuarioUnidade_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsuarioUnidade" ADD CONSTRAINT "UsuarioUnidade_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

