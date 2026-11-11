-- Existing accounts receive no administrative permission automatically.
ALTER TABLE "Usuario" ADD COLUMN "gerenciaEquipe" BOOLEAN NOT NULL DEFAULT false;
