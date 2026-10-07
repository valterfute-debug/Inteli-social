-- Aditiva: mantém dados existentes e tarefas sobrevivem à exclusão da linha Foto.
CREATE TABLE "RemocaoArquivo" (
    "id" TEXT NOT NULL,
    "fotoId" TEXT NOT NULL,
    "caminhoArmazenamento" TEXT NOT NULL,
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimaTentativaEm" TIMESTAMP(3),
    "ultimoErro" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RemocaoArquivo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RemocaoArquivo_caminhoArmazenamento_key" ON "RemocaoArquivo"("caminhoArmazenamento");
CREATE INDEX "RemocaoArquivo_fotoId_idx" ON "RemocaoArquivo"("fotoId");
CREATE INDEX "RemocaoArquivo_createdAt_idx" ON "RemocaoArquivo"("createdAt");

-- Estas tabelas são consumidas pela API privilegiada, não diretamente pelo navegador.
-- Fechar PostgREST evita contornar a autorização por unidade do NestJS. Sem FORCE RLS:
-- o proprietário/role de servidor continua operando normalmente. Não criar policy pública.
DO $$
DECLARE
  tabela TEXT;
  papel TEXT;
BEGIN
  FOREACH tabela IN ARRAY ARRAY[
    'Species', 'Breed', 'Unit', 'Location', 'Responsible', 'Animal', 'Foto',
    'Usuario', 'UsuarioUnidade', 'ChaveIdempotencia', 'EventoAuditoria',
    'HealthEvent', 'RemocaoArquivo', '_prisma_migrations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tabela);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tabela);
    FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tabela, papel);
      END IF;
    END LOOP;
  END LOOP;
END $$;
