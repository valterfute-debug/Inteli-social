-- Preserva as migrations anteriores e os dados existentes.
-- As FKs compostas impedem vínculos cruzados inconsistentes em Animal.
-- Os índices únicos tornam os pares referenciados chaves candidatas no PostgreSQL.

CREATE UNIQUE INDEX "Breed_id_speciesId_key" ON "Breed"("id", "speciesId");
CREATE UNIQUE INDEX "Location_id_unitId_key" ON "Location"("id", "unitId");

ALTER TABLE "Animal"
  ADD CONSTRAINT "Animal_breedId_speciesId_fkey"
  FOREIGN KEY ("breedId", "speciesId")
  REFERENCES "Breed"("id", "speciesId")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;

ALTER TABLE "Animal"
  ADD CONSTRAINT "Animal_locationId_unitId_fkey"
  FOREIGN KEY ("locationId", "unitId")
  REFERENCES "Location"("id", "unitId")
  ON DELETE NO ACTION
  ON UPDATE CASCADE;
