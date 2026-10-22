-- Decisão da equipe: acaba a divisão ADMIN/OPERADOR e, com ela, o escopo por unidade.
-- Todas as contas liberadas e ativas fazem as mesmas operações em todas as unidades.
--
-- O que NÃO muda: nenhuma conta é apagada ou desativada; `ativo` e o login pelo Supabase Auth
-- continuam sendo a porta de entrada, então quem acessava continua acessando.
-- O que é removido (informação que deixa de ter função): o papel de cada conta e os vínculos
-- conta × unidade. FAÇA BACKUP VERIFICÁVEL antes de aplicar em qualquer banco real; a
-- remoção destas duas informações não é reversível por migration.
DROP TABLE "UsuarioUnidade";
ALTER TABLE "Usuario" DROP COLUMN "papel";
DROP TYPE "PapelUsuario";

-- Histórico operacional de passagens entre áreas, separado da auditoria técnica: qualquer conta
-- consulta. Só recebe inserções pela API e preserva a linha do tempo mesmo com o animal
-- arquivado. Animais anteriores a esta migration começam sem histórico (as passagens antigas
-- continuam apenas na auditoria); a primeira passagem registrada já traz a origem correta.
CREATE TABLE "MovimentacaoAnimal" (
    "id" TEXT NOT NULL,
    "animalId" TEXT NOT NULL,
    "frenteOrigem" "Front",
    "frenteDestino" "Front" NOT NULL,
    "unidadeOrigemId" TEXT,
    "unidadeDestinoId" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovimentacaoAnimal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MovimentacaoAnimal_animalId_createdAt_idx" ON "MovimentacaoAnimal"("animalId", "createdAt");

ALTER TABLE "MovimentacaoAnimal" ADD CONSTRAINT "MovimentacaoAnimal_animalId_fkey" FOREIGN KEY ("animalId") REFERENCES "Animal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimentacaoAnimal" ADD CONSTRAINT "MovimentacaoAnimal_unidadeOrigemId_fkey" FOREIGN KEY ("unidadeOrigemId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimentacaoAnimal" ADD CONSTRAINT "MovimentacaoAnimal_unidadeDestinoId_fkey" FOREIGN KEY ("unidadeDestinoId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Mesmo fechamento das demais tabelas: só a API privilegiada acessa; PostgREST não alcança.
ALTER TABLE public."MovimentacaoAnimal" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."MovimentacaoAnimal" FROM PUBLIC;
DO $$
DECLARE
  papel TEXT;
BEGIN
  FOREACH papel IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."MovimentacaoAnimal" FROM %I', papel);
    END IF;
  END LOOP;
END $$;
