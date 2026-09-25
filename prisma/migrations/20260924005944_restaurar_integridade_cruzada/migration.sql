-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_breedId_fkey";

-- DropForeignKey
ALTER TABLE "Animal" DROP CONSTRAINT "Animal_locationId_fkey";

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_breedId_speciesId_fkey" FOREIGN KEY ("breedId", "speciesId") REFERENCES "Breed"("id", "speciesId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Animal" ADD CONSTRAINT "Animal_locationId_unitId_fkey" FOREIGN KEY ("locationId", "unitId") REFERENCES "Location"("id", "unitId") ON DELETE RESTRICT ON UPDATE CASCADE;
