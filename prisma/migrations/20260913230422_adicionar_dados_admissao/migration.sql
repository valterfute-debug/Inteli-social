-- CreateEnum
CREATE TYPE "Sexo" AS ENUM ('MACHO', 'FEMEA');

-- CreateEnum
CREATE TYPE "Porte" AS ENUM ('PEQUENO', 'MEDIO', 'GRANDE');

-- AlterTable
ALTER TABLE "Animal" ADD COLUMN     "cor" TEXT,
ADD COLUMN     "dataEntrada" TIMESTAMP(3),
ADD COLUMN     "idadeAproximadaMeses" INTEGER,
ADD COLUMN     "microchip" TEXT,
ADD COLUMN     "pesoKg" DECIMAL(6,2),
ADD COLUMN     "porte" "Porte",
ADD COLUMN     "sexo" "Sexo";

-- AlterTable
ALTER TABLE "Responsible" ADD COLUMN     "email" TEXT,
ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "telefone" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "endereco" TEXT,
ADD COLUMN     "horariosFuncionamento" TEXT;
