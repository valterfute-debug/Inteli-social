-- Localização física deixa de ser exigida no cadastro. Aditiva: nenhuma coluna ou linha é
-- removida; os animais antigos mantêm a localização que já tinham. A FK composta
-- (locationId, unitId) continua valendo quando a localização é informada (MATCH SIMPLE
-- ignora a checagem se locationId é nulo).
ALTER TABLE "Animal" ALTER COLUMN "locationId" DROP NOT NULL;

-- Onça: uma espécie com duas raças (Onça-pintada e Onça-parda), em vez de uma espécie por
-- tipo. Idempotente e sem apagar nada: a espécie antiga "Onça-pintada" é arquivada (deletedAt)
-- e seus animais passam para a nova espécie com a raça correspondente.
INSERT INTO "Species" ("id", "name", "silvestre", "updatedAt")
SELECT gen_random_uuid()::text, 'Onça', true, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "Species" WHERE "name" = 'Onça');

INSERT INTO "Breed" ("id", "name", "speciesId")
SELECT gen_random_uuid()::text, raca.nome, especie."id"
FROM "Species" especie
CROSS JOIN (VALUES ('Onça-pintada'), ('Onça-parda')) AS raca(nome)
WHERE especie."name" = 'Onça'
  AND NOT EXISTS (
    SELECT 1 FROM "Breed" existente
    WHERE existente."speciesId" = especie."id" AND existente."name" = raca.nome
  );

UPDATE "Animal" animal
SET "speciesId" = nova."id",
    -- Versão e data mudam para que clientes com a ficha antiga em cache recebam 409 ao editar.
    "version" = animal."version" + 1,
    "updatedAt" = CURRENT_TIMESTAMP,
    "breedId" = (
      SELECT "id" FROM "Breed" WHERE "speciesId" = nova."id" AND "name" = 'Onça-pintada'
    )
FROM "Species" antiga, "Species" nova
WHERE antiga."name" = 'Onça-pintada'
  AND nova."name" = 'Onça'
  AND animal."speciesId" = antiga."id";

UPDATE "Species"
SET "deletedAt" = CURRENT_TIMESTAMP
WHERE "name" = 'Onça-pintada'
  AND "deletedAt" IS NULL
  AND EXISTS (SELECT 1 FROM "Species" WHERE "name" = 'Onça');
