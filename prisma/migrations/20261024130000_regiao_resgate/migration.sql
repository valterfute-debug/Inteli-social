-- Região onde o animal foi recolhido (pedido da Ampara: levantamento das regiões de resgate).
-- Aditiva e opcional: animais antigos ficam com a região vazia (null).
ALTER TABLE "Animal" ADD COLUMN "regiaoResgate" TEXT;

CREATE INDEX "Animal_regiaoResgate_idx" ON "Animal"("regiaoResgate");
