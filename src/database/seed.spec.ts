import { PrismaClient } from '@prisma/client';
import { CATALOGO_INICIAL, popularCatalogos } from './seed';

function criarPrismaFalso(responsavelExistente: unknown = null) {
  return {
    species: { upsert: jest.fn().mockResolvedValue({ id: 'especie' }) },
    breed: { upsert: jest.fn() },
    unit: { upsert: jest.fn().mockResolvedValue({ id: 'unidade' }) },
    location: { upsert: jest.fn() },
    responsible: {
      findFirst: jest.fn().mockResolvedValue(responsavelExistente),
      create: jest.fn(),
    },
  } as unknown as PrismaClient;
}

describe('Seed de catálogos', () => {
  it('inclui o Mantenedor e ao menos uma espécie silvestre', () => {
    expect(CATALOGO_INICIAL.unidades.map((u) => u.nome)).toContain('Mantenedor');
    expect(CATALOGO_INICIAL.especies.some((e) => e.silvestre)).toBe(true);
    expect(CATALOGO_INICIAL.unidades.every((u) => u.localizacoes.length > 0)).toBe(true);
  });

  it('usa upsert sem atualização (idempotente, não sobrescreve dados)', async () => {
    const prisma = criarPrismaFalso();
    await popularCatalogos(prisma);

    expect(prisma.species.upsert).toHaveBeenCalledTimes(CATALOGO_INICIAL.especies.length);
    for (const [chamada] of (prisma.species.upsert as jest.Mock).mock.calls) {
      expect(chamada.update).toEqual({});
    }
    expect(prisma.responsible.create).toHaveBeenCalledTimes(1);
  });

  it('não duplica responsável já existente', async () => {
    const prisma = criarPrismaFalso({ id: 'r1' });
    await popularCatalogos(prisma);

    expect(prisma.responsible.create).not.toHaveBeenCalled();
  });
});
