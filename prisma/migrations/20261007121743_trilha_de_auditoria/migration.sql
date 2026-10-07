-- Issue #3, P0-4: trilha de auditoria append-only. Aditiva.

-- CreateTable
CREATE TABLE "EventoAuditoria" (
    "id" TEXT NOT NULL,
    "instante" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usuarioId" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "entidade" TEXT NOT NULL,
    "entidadeId" TEXT NOT NULL,
    "unidadeId" TEXT,
    "frente" "Front",
    "camposAlterados" JSONB,
    "requisicaoId" TEXT,

    CONSTRAINT "EventoAuditoria_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventoAuditoria_entidade_entidadeId_instante_idx" ON "EventoAuditoria"("entidade", "entidadeId", "instante");

-- CreateIndex
CREATE INDEX "EventoAuditoria_usuarioId_instante_idx" ON "EventoAuditoria"("usuarioId", "instante");

-- CreateIndex
CREATE INDEX "EventoAuditoria_instante_idx" ON "EventoAuditoria"("instante");

-- Append-only garantido pelo banco, não só pela aplicação: UPDATE nunca; DELETE só de
-- eventos mais antigos que a retenção (5 anos, política provisória a aprovar com a Ampara).
CREATE OR REPLACE FUNCTION "auditoria_somente_inclusao"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'EventoAuditoria é somente inclusão: UPDATE não permitido';
  END IF;
  IF OLD."instante" > now() - interval '5 years' THEN
    RAISE EXCEPTION 'EventoAuditoria é somente inclusão: DELETE só após o prazo de retenção';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "EventoAuditoria_somente_inclusao"
  BEFORE UPDATE OR DELETE ON "EventoAuditoria"
  FOR EACH ROW EXECUTE FUNCTION "auditoria_somente_inclusao"();
