-- Issue #3, P0-3: Idempotency-Key gravada na mesma transação da escrita, para que
-- reenvios da fila offline não dupliquem cadastros. Aditiva.

-- CreateTable
CREATE TABLE "ChaveIdempotencia" (
    "usuarioId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "operacao" TEXT NOT NULL,
    "hashConteudo" TEXT NOT NULL,
    "recursoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChaveIdempotencia_pkey" PRIMARY KEY ("usuarioId","chave")
);

-- CreateIndex
CREATE INDEX "ChaveIdempotencia_createdAt_idx" ON "ChaveIdempotencia"("createdAt");

-- AddForeignKey
ALTER TABLE "ChaveIdempotencia" ADD CONSTRAINT "ChaveIdempotencia_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
