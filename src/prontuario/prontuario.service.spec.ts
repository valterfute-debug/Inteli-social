import { NotFoundException } from '@nestjs/common';
import { Front, Sexo, TipoEventoSaude } from '@prisma/client';
import { ProntuarioService } from './prontuario.service';
import { PrismaService } from '../prisma/prisma.service';

function criarAnimalComRelacoesFalso() {
  return {
    id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    name: 'Rex',
    publicId: 'QA-001',
    microchip: null,
    dataEntrada: new Date('2026-01-01T00:00:00.000Z'),
    sexo: Sexo.MACHO,
    idadeAproximadaMeses: 24,
    pesoKg: null,
    porte: null,
    cor: 'Caramelo',
    speciesId: 'especie-1',
    species: { id: 'especie-1', name: 'Cão' },
    breedId: null,
    breed: null,
    unitId: 'unidade-1',
    unit: { id: 'unidade-1', name: 'Unidade Central' },
    locationId: 'local-1',
    location: { id: 'local-1', name: 'Canil 1' },
    responsibleId: 'responsavel-1',
    responsible: { id: 'responsavel-1', name: 'Maria' },
    front: Front.CASADOTE,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

function criarPrismaFalso() {
  return {
    animal: { findFirst: jest.fn() },
    healthEvent: { findMany: jest.fn() },
  } as unknown as PrismaService;
}

describe('ProntuarioService', () => {
  it('rejeita geração de PDF para animal inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
    const service = new ProntuarioService(prisma);

    await expect(service.gerarPdf('id-inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gera um PDF válido com os dados do animal e histórico de saúde', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'evento-1',
        animalId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
        tipo: TipoEventoSaude.VACINA,
        descricao: 'V10',
        data: new Date('2026-02-01T00:00:00.000Z'),
        observacoes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    const service = new ProntuarioService(prisma);

    const pdf = await service.gerarPdf('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('gera um PDF mesmo sem eventos de saúde registrados', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    const service = new ProntuarioService(prisma);

    const pdf = await service.gerarPdf('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
