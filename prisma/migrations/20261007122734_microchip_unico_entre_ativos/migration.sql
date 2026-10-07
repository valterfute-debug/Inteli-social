-- Microchip único entre animais ATIVOS, garantido pelo banco (antes só pelo código, o que
-- deixava passar dois cadastros simultâneos com o mesmo chip). Animal arquivado libera o
-- número para readmissão. Índice parcial: o Prisma não o representa no schema.prisma, mas
-- também não o remove em migrations futuras (conferido com `prisma migrate diff`).
--
-- Se esta migration falhar por duplicidade, já existem dois animais ativos com o mesmo
-- microchip. Para encontrá-los:
--   SELECT "microchip", array_agg("publicId") FROM "Animal"
--   WHERE "deletedAt" IS NULL AND "microchip" IS NOT NULL
--   GROUP BY "microchip" HAVING count(*) > 1;
CREATE UNIQUE INDEX "Animal_microchip_ativo_key" ON "Animal"("microchip")
  WHERE "deletedAt" IS NULL AND "microchip" IS NOT NULL;
