import { Animal as AnimalPrisma } from '@prisma/client';

export function mapearAnimal(animal: AnimalPrisma) {
  return {
    id: animal.id,
    identificadorPublico: animal.publicId,
    nome: animal.name,
    microchip: animal.microchip,
    especieId: animal.speciesId,
    racaId: animal.breedId,
    unidadeId: animal.unitId,
    localizacaoId: animal.locationId,
    responsavelId: animal.responsibleId,
    frente: animal.front,
    dataEntrada: animal.dataEntrada ? animal.dataEntrada.toISOString() : null,
    sexo: animal.sexo,
    idadeAproximadaMeses: animal.idadeAproximadaMeses,
    pesoKg: animal.pesoKg === null ? null : Number(animal.pesoKg),
    porte: animal.porte,
    cor: animal.cor,
    observacoes: animal.observacoes,
    fotoEntradaId: animal.fotoEntradaId,
    versao: animal.version,
    criadoEm: animal.createdAt.toISOString(),
    atualizadoEm: animal.updatedAt.toISOString(),
    arquivadoEm: animal.deletedAt ? animal.deletedAt.toISOString() : null,
  };
}
