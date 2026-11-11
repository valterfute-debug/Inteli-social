-- Aditiva: preserva históricos e admissão automática vazia.
ALTER TABLE "AtendimentoClinico"
  ADD COLUMN "frequenciaRespiratoria" INTEGER,
  ADD COLUMN "frequenciaCardiaca" INTEGER,
  ADD COLUMN "tpc" DOUBLE PRECISION,
  ADD COLUMN "mucosa" TEXT,
  ADD COLUMN "linfonodos" TEXT,
  ADD COLUMN "temperatura" DOUBLE PRECISION;
ALTER TABLE "AtendimentoClinico" ADD CONSTRAINT "exame_fisico_integridade" CHECK (
  num_nonnulls("frequenciaRespiratoria", "frequenciaCardiaca", "tpc", "mucosa", "linfonodos", "temperatura") = 0 OR (
  num_nonnulls("frequenciaRespiratoria", "frequenciaCardiaca", "tpc", "mucosa", "linfonodos", "temperatura") = 6
  AND "frequenciaRespiratoria" >= 0 AND "frequenciaCardiaca" >= 0 AND "tpc" >= 0 AND "tpc" < 'Infinity'::float8
  AND "temperatura" > '-Infinity'::float8 AND "temperatura" < 'Infinity'::float8
  AND length(trim("mucosa")) BETWEEN 1 AND 500 AND length(trim("linfonodos")) BETWEEN 1 AND 500));
CREATE TABLE "AnexoClinico" (
  "id" TEXT PRIMARY KEY,
  "atendimentoId" TEXT NOT NULL REFERENCES "AtendimentoClinico"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "nome" TEXT NOT NULL,
  "tipoMidia" TEXT NOT NULL,
  "tamanhoBytes" INTEGER NOT NULL CHECK ("tamanhoBytes" > 0),
  "caminhoArmazenamento" TEXT NOT NULL UNIQUE,
  "criadoPorId" TEXT NOT NULL,
  "confirmado" BOOLEAN NOT NULL DEFAULT false,
  "cancelado" BOOLEAN NOT NULL DEFAULT false,
  "expiraEm" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AnexoClinico_atendimentoId_createdAt_idx" ON "AnexoClinico"("atendimentoId", "createdAt");
ALTER TABLE public."AnexoClinico" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AnexoClinico" FROM PUBLIC;
DO $$ DECLARE papel TEXT; BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."AnexoClinico" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
