-- Prontuário clínico por atendimento. Aditiva: só cria enum, tabela, índices e FKs; nenhuma
-- tabela ou linha existente é alterada.
CREATE TYPE "TipoAtendimento" AS ENUM ('ADMISSAO', 'ACOMPANHAMENTO');

CREATE TABLE "AtendimentoClinico" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "tipo" "TipoAtendimento" NOT NULL,
    "dataAtendimento" TIMESTAMP(3) NOT NULL,
    "anamnese" TEXT,
    "exameFisico" TEXT,
    "examesComplementares" TEXT,
    "tratamento" TEXT,
    "criadoPorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AtendimentoClinico_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AtendimentoClinico_animalId_dataAtendimento_idx" ON "AtendimentoClinico"("animalId", "dataAtendimento");
CREATE INDEX "AtendimentoClinico_responsibleId_idx" ON "AtendimentoClinico"("responsibleId");

-- Histórico preservado: sem CASCADE. Animal e responsável com atendimentos não podem ser
-- apagados do banco (o sistema só arquiva, via deletedAt).
ALTER TABLE "AtendimentoClinico" ADD CONSTRAINT "AtendimentoClinico_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AtendimentoClinico" ADD CONSTRAINT "AtendimentoClinico_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Responsible"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Um único atendimento de admissão ativo por animal, garantido pelo banco (duas requisições
-- simultâneas não criam duas admissões). Índice parcial: o Prisma não o representa no
-- schema.prisma, como em "Animal_microchip_ativo_key".
CREATE UNIQUE INDEX "AtendimentoClinico_admissao_ativa_key" ON "AtendimentoClinico"("animalId")
  WHERE "tipo" = 'ADMISSAO' AND "deletedAt" IS NULL;

-- Mesmo fechamento das demais tabelas (ver 20261007143000_remocoes_duraveis_e_rls): a tabela
-- é usada só pela API privilegiada; PostgREST (anon/authenticated) não deve alcançá-la.
ALTER TABLE public."AtendimentoClinico" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."AtendimentoClinico" FROM PUBLIC;
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."AtendimentoClinico" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
