import { Prisma } from '@prisma/client';

/** Relações carregadas em toda leitura de animal: a ficha e a lista exibem os nomes, não só os ids. */
export const INCLUSAO_ANIMAL = {
  species: true,
  unit: true,
  location: true,
  fotoEntrada: true,
} satisfies Prisma.AnimalInclude;

export type AnimalComRelacoes = Prisma.AnimalGetPayload<{ include: typeof INCLUSAO_ANIMAL }>;

export function mapearAnimal(animal: AnimalComRelacoes, fotoEntradaUrl: string | null = null) {
  return {
    id: animal.id,
    identificadorPublico: animal.publicId,
    nome: animal.name,
    microchip: animal.microchip,
    especieId: animal.speciesId,
    especieNome: animal.species.name,
    especieSilvestre: animal.species.silvestre,
    racaId: animal.breedId,
    unidadeId: animal.unitId,
    unidadeNome: animal.unit.name,
    localizacaoId: animal.locationId,
    localizacaoNome: animal.location.name,
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
    fotoEntradaUrl,
    versao: animal.version,
    criadoEm: animal.createdAt.toISOString(),
    atualizadoEm: animal.updatedAt.toISOString(),
    arquivadoEm: animal.deletedAt ? animal.deletedAt.toISOString() : null,
  };
}
