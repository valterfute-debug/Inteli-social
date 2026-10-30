import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { USUARIO_TESTE } from '../../test/usuarios-teste';
import { auditoriaFalsa, comTransacao } from '../../test/auditoria-teste';
import { PrismaService } from '../prisma/prisma.service';
import { CatalogosService } from './catalogos.service';

describe('Catálogo de raças', () => {
  function ambiente() {
    const prisma = comTransacao({
      $executeRaw: jest.fn().mockResolvedValue(1),
      species: { findFirst: jest.fn().mockResolvedValue({ id: 'especie' }) },
      breed: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'raca', name: 'Anterior', speciesId: 'especie' }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'raca', name: 'Anterior', speciesId: 'especie' }),
        create: jest
          .fn()
          .mockResolvedValue({ id: 'raca', name: 'Raça teste', speciesId: 'especie' }),
        update: jest.fn().mockResolvedValue({ id: 'raca', name: 'Nova', speciesId: 'especie' }),
      },
    });
    const auditoria = auditoriaFalsa();
    return {
      prisma,
      auditoria,
      service: new CatalogosService(prisma as unknown as PrismaService, auditoria),
    };
  }

  it('normaliza espaços, vincula à espécie e audita a criação', async () => {
    const { prisma, auditoria, service } = ambiente();
    expect(
      await service.criarRaca({ nome: '  Raça   teste ', especieId: 'especie' }, USUARIO_TESTE),
    ).toEqual({ id: 'raca', nome: 'Raça teste', especieId: 'especie' });
    expect(prisma.breed.create).toHaveBeenCalledWith({
      data: { name: 'Raça teste', speciesId: 'especie' },
    });
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ acao: 'RACA_CRIADA', entidade: 'Breed' }),
    );
  });

  it('recusa duplicidade apenas na espécie selecionada, sem diferenciar caixa', async () => {
    const { prisma, service } = ambiente();
    prisma.breed.findFirst.mockResolvedValue({ id: 'existente' } as never);
    await expect(
      service.criarRaca({ nome: 'Raça teste', especieId: 'especie' }, USUARIO_TESTE),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.breed.findFirst).toHaveBeenCalledWith({
      where: { speciesId: 'especie', name: { equals: 'Raça teste', mode: 'insensitive' } },
    });
    expect(prisma.breed.create).not.toHaveBeenCalled();
  });

  it('recusa espécie inexistente ou inativa e nomes vazios', async () => {
    const { prisma, service } = ambiente();
    prisma.species.findFirst.mockResolvedValue(null as never);
    await expect(
      service.criarRaca({ nome: 'Raça', especieId: 'especie' }, USUARIO_TESTE),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.criarRaca({ nome: '  ', especieId: 'especie' }, USUARIO_TESTE),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.breed.create).not.toHaveBeenCalled();
  });

  it('edita somente nome, preserva espécie e registra antes/depois', async () => {
    const { prisma, auditoria, service } = ambiente();
    await service.atualizarRaca('raca', { nome: 'Nova' }, USUARIO_TESTE);
    expect(prisma.breed.update).toHaveBeenCalledWith({
      where: { id: 'raca' },
      data: { name: 'Nova' },
    });
    expect(prisma.breed.findFirst).toHaveBeenCalledWith({
      where: {
        speciesId: 'especie',
        name: { equals: 'Nova', mode: 'insensitive' },
        id: { not: 'raca' },
      },
    });
    expect(auditoria.registrar).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ camposAlterados: { name: { antes: 'Anterior', depois: 'Nova' } } }),
    );
    prisma.breed.findUnique.mockResolvedValue(null as never);
    await expect(
      service.atualizarRaca('ausente', { nome: 'Nova' }, USUARIO_TESTE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
