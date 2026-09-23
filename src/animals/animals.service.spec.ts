import { ConflictException, NotFoundException } from '@nestjs/common';
import { Front, Prisma, Sexo } from '@prisma/client';
import { AnimalsService } from './animals.service';
import { PrismaService } from '../prisma/prisma.service';

function criarAnimalFalso(sobrescritas: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    name: 'Rex',
    publicId: 'QA-001',
    microchip: null,
    dataEntrada: null,
    sexo: Sexo.MACHO,
    idadeAproximadaMeses: null,
    pesoKg: null,
    porte: null,
    cor: null,
    speciesId: 'especie-1',
    breedId: null,
    unitId: 'unidade-1',
    locationId: 'local-1',
    responsibleId: 'responsavel-1',
    front: Front.CASADOTE,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...sobrescritas,
  };
}

function criarPrismaFalso() {
  return {
    animal: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('AnimalsService', () => {
  it('cria um animal e devolve a resposta mapeada no formato do contrato', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.create as jest.Mock).mockResolvedValue(criarAnimalFalso());
    const service = new AnimalsService(prisma);

    const resposta = await service.criar({
      identificadorPublico: 'QA-001',
      nome: 'Rex',
      especieId: 'especie-1',
      unidadeId: 'unidade-1',
      localizacaoId: 'local-1',
      responsavelId: 'responsavel-1',
      frente: Front.CASADOTE,
      sexo: Sexo.MACHO,
    });

    expect(resposta.identificadorPublico).toBe('QA-001');
    expect(resposta.versao).toBe(1);
  });

  it('converte violação de identificador público duplicado em 409', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '6.19.3',
      }),
    );
    const service = new AnimalsService(prisma);

    await expect(
      service.criar({
        identificadorPublico: 'QA-001',
        especieId: 'especie-1',
        unidadeId: 'unidade-1',
        localizacaoId: 'local-1',
        responsavelId: 'responsavel-1',
        frente: Front.CASADOTE,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejeita atualização com versão desatualizada com 409', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalFalso());
    const service = new AnimalsService(prisma);

    await expect(service.atualizar(criarAnimalFalso().id, { versao: 1, nome: 'Novo nome' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('retorna 404 ao tentar atualizar animal inexistente', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
    const service = new AnimalsService(prisma);

    await expect(service.atualizar('id-inexistente', { versao: 1, nome: 'Novo nome' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('retorna 404 ao arquivar animal inexistente', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new AnimalsService(prisma);

    await expect(service.arquivar('id-inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });
});
