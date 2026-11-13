ALTER TABLE "Usuario" ADD COLUMN "administradorMaster" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Usuario" ADD CONSTRAINT "usuario_master_gerencia_equipe" CHECK (NOT "administradorMaster" OR "gerenciaEquipe");
