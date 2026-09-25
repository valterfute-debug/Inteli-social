import { NotFoundException } from '@nestjs/common';
import { TipoEventoSaude } from '@prisma/client';
import { HealthEventsService } from './health-events.service';
import { PrismaService } from '../prisma/prisma.service';

function criarEventoFalso(sobrescritas: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    animalId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    tipo: TipoEventoSaude.VACINA,
    descricao: 'V10',
    data: new Date('2026-01-10T00:00:00.000Z'),
    observacoes: null,
    createdAt: new Date('2026-01-10T00:00:00.000Z'),
    updatedAt: new Date('2026-01-10T00:00:00.000Z'),
    deletedAt: null,
    ...sobrescritas,
  };
}

function criarPrismaFalso() {
  return {
    animal: {
      findFirst: jest.fn(),
    },
    healthEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

describe('HealthEventsService', () => {
  it('rejeita criação de evento para animal inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
    const service = new HealthEventsService(prisma);

    await expect(
      service.criar('animal-inexistente', {
        tipo: TipoEventoSaude.VACINA,
        data: '2026-01-10',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cria um evento de saúde vinculado ao animal', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue({ id: 'animal-1' });
    (prisma.healthEvent.create as jest.Mock).mockResolvedValue(criarEventoFalso());
    const service = new HealthEventsService(prisma);

    const resposta = await service.criar('animal-1', {
      tipo: TipoEventoSaude.VACINA,
      descricao: 'V10',
      data: '2026-01-10',
    });

    expect(resposta.tipo).toBe(TipoEventoSaude.VACINA);
    expect(resposta.descricao).toBe('V10');
  });

  it('lista eventos filtrando por tipo', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue({ id: 'animal-1' });
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([criarEventoFalso()]);
    (prisma.healthEvent.count as jest.Mock).mockResolvedValue(1);
    const service = new HealthEventsService(prisma);

    const resposta = await service.listar('animal-1', {
      pagina: 1,
      limite: 20,
      tipo: TipoEventoSaude.VACINA,
    });

    expect(resposta.total).toBe(1);
    expect(resposta.itens[0].tipo).toBe(TipoEventoSaude.VACINA);
  });

  it('retorna 404 ao arquivar evento inexistente', async () => {
    const prisma = criarPrismaFalso();
    (prisma.healthEvent.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new HealthEventsService(prisma);

    await expect(service.arquivar('animal-1', 'evento-inexistente')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
