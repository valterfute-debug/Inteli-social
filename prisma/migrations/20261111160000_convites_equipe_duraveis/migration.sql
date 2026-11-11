CREATE TABLE "ConviteEquipe" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "solicitadoPor" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ConviteEquipe_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ConviteEquipe_email_key" ON "ConviteEquipe"("email");
