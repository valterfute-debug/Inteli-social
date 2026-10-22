import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Front, Prisma, Sexo, TipoAtendimento } from '@prisma/client';
import { auditoriaFalsa, comTransacao } from '../../test/auditoria-teste';
import { ESCOPO_ADMIN, escopoOperador } from '../../test/escopos-teste';
import { CHAVE_TESTE, idempotenciaFalsa } from '../../test/idempotencia-teste';
import { PrismaService } from '../prisma/prisma.service';
import { AtendimentosClinicosService } from './atendimentos-clinicos.service';

const ID_ANIMAL = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';
const ID_ATENDIMENTO = 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2';

const ANIMAL_ACESSIVEL = { unitId: 'unidade-1', front: Front.CASADOTE, responsibleId: 'resp-1' };

function criarAtendimentoFalso(sobrescritas: Partial<Record<string, unknown>> = {}) {
  return {
    id: ID_ATENDIMENTO,
    animalId: ID_ANIMAL,
    responsibleId: 'resp-1',
    tipo: TipoAtendimento.ADMISSAO,
    dataAtendimento: new Date('2026-02-01T10:00:00.000Z'),
    anamnese: 'Resgatado na rua',
    exameFisico: null,
    examesComplementares: null,
    tratamento: null,
    criadoPorId: 'admin-1',
    version: 1,
    createdAt: new Date('2026-02-01T10:00:00.000Z'),
    updatedAt: new Date('2026-02-01T10:00:00.000Z'),
    deletedAt: null,
    animal: {
      id: ID_ANIMAL,
      publicId: 'QA-001',
      name: 'Rex',
      sexo: Sexo.MACHO,
      species: { name: 'Cão' },
      breed: null,
    },
    responsible: { id: 'resp-1', name: 'Maria', endereco: 'Rua das Flores, 10' },
    ...sobrescritas,
  };
}

function criarPrismaFalso() {
  return {
    animal: { findFirst: jest.fn().mockResolvedValue(ANIMAL_ACESSIVEL) },
    atendimentoClinico: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(criarAtendimentoFalso()),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
  } as unknown as PrismaService;
}

function criarServico(prisma: PrismaService, auditoria = auditoriaFalsa()) {
  return new AtendimentosClinicosService(
    comTransacao(prisma),
    idempotenciaFalsa(prisma),
    auditoria,
  );
}

describe('AtendimentosClinicosService', () => {
  describe('criar', () => {
    it('registra a admissão vinculada ao animal e ao responsável atual dele', async () => {
      const prisma = criarPrismaFalso();
      const auditoria = auditoriaFalsa();
      const service = criarServico(prisma, auditoria);

      const { atendimento, reenvio } = await service.criar(
        ID_ANIMAL,
        { anamnese: 'Resgatado na rua', exameFisico: 'Temperatura 38,5' },
        ESCOPO_ADMIN,
        CHAVE_TESTE,
      );

      const { data } = (prisma.atendimentoClinico.create as jest.Mock).mock.calls[0][0];
      expect(data).toMatchObject({
        animalId: ID_ANIMAL,
        responsibleId: 'resp-1',
        tipo: TipoAtendimento.ADMISSAO,
        anamnese: 'Resgatado na rua',
        exameFisico: 'Temperatura 38,5',
        criadoPorId: 'admin-1',
      });
      expect(reenvio).toBe(false);
      // Identificação do animal e do responsável vem pelo relacionamento.
      expect(atendimento).toMatchObject({
        animalId: ID_ANIMAL,
        tipo: TipoAtendimento.ADMISSAO,
        animal: { identificadorPublico: 'QA-001', nome: 'Rex', especieNome: 'Cão' },
        responsavel: { nome: 'Maria', endereco: 'Rua das Flores, 10' },
      });
      expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    });

    it('o atendimento seguinte, sem tipo informado, vira acompanhamento e não toca no anterior', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.count as jest.Mock).mockResolvedValue(1);
      const service = criarServico(prisma);

      await service.criar(ID_ANIMAL, { tratamento: 'Vermífugo' }, ESCOPO_ADMIN, CHAVE_TESTE);

      const { data } = (prisma.atendimentoClinico.create as jest.Mock).mock.calls[0][0];
      expect(data.tipo).toBe(TipoAtendimento.ACOMPANHAMENTO);
      expect(prisma.atendimentoClinico.updateMany).not.toHaveBeenCalled();
    });

    it('recusa uma segunda admissão com 409', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.count as jest.Mock).mockResolvedValue(1);
      const service = criarServico(prisma);

      await expect(
        service.criar(ID_ANIMAL, { tipo: TipoAtendimento.ADMISSAO }, ESCOPO_ADMIN, CHAVE_TESTE),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.atendimentoClinico.create).not.toHaveBeenCalled();
    });

    it('traduz a violação do índice de admissão única (corrida) em 409', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicado', {
          code: 'P2002',
          clientVersion: 'teste',
        }),
      );
      const service = criarServico(prisma);

      await expect(
        service.criar(ID_ANIMAL, {}, ESCOPO_ADMIN, CHAVE_TESTE),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('não cria prontuário para animal inexistente (404)', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
      const service = criarServico(prisma);

      await expect(service.criar(ID_ANIMAL, {}, ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.atendimentoClinico.create).not.toHaveBeenCalled();
    });

    it('recusa animal de unidade fora do escopo do usuário (403)', async () => {
      const prisma = criarPrismaFalso();
      const service = criarServico(prisma);

      await expect(
        service.criar(ID_ANIMAL, {}, escopoOperador(['outra-unidade']), CHAVE_TESTE),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.atendimentoClinico.create).not.toHaveBeenCalled();
    });
  });

  describe('listar e buscar', () => {
    it('lista o histórico do animal, mais recente primeiro, sem arquivados', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([
        criarAtendimentoFalso({ id: 'novo', tipo: TipoAtendimento.ACOMPANHAMENTO }),
        criarAtendimentoFalso(),
      ]);
      (prisma.atendimentoClinico as unknown as { count: jest.Mock }).count.mockResolvedValue(2);
      const service = criarServico(prisma);

      const resposta = await service.listar(ID_ANIMAL, { pagina: 1, limite: 20 }, ESCOPO_ADMIN);

      expect(prisma.atendimentoClinico.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { animalId: ID_ANIMAL, deletedAt: null },
          orderBy: [{ dataAtendimento: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
        }),
      );
      expect(resposta.itens.map((item) => item.id)).toEqual(['novo', ID_ATENDIMENTO]);
      expect(resposta.total).toBe(2);
    });

    it('consulta um atendimento do animal e devolve 404 se for de outro animal', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findFirst as jest.Mock)
        .mockResolvedValueOnce(criarAtendimentoFalso())
        .mockResolvedValueOnce(null);
      const service = criarServico(prisma);

      const encontrado = await service.buscar(ID_ANIMAL, ID_ATENDIMENTO, ESCOPO_ADMIN);
      expect(encontrado.id).toBe(ID_ATENDIMENTO);
      expect((prisma.atendimentoClinico.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
        id: ID_ATENDIMENTO,
        animalId: ID_ANIMAL,
        deletedAt: null,
      });
      await expect(
        service.buscar(ID_ANIMAL, ID_ATENDIMENTO, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('atualizar', () => {
    it('grava as seções informadas, incrementa a versão e audita só os nomes dos campos', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findFirst as jest.Mock).mockResolvedValue(
        criarAtendimentoFalso(),
      );
      (prisma.atendimentoClinico.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const auditoria = auditoriaFalsa();
      const service = criarServico(prisma, auditoria);

      await service.atualizar(
        ID_ANIMAL,
        ID_ATENDIMENTO,
        { versao: 1, tratamento: 'Antibiótico por 7 dias' },
        ESCOPO_ADMIN,
      );

      expect(prisma.atendimentoClinico.updateMany).toHaveBeenCalledWith({
        where: { id: ID_ATENDIMENTO, animalId: ID_ANIMAL, deletedAt: null, version: 1 },
        data: expect.objectContaining({
          tratamento: 'Antibiótico por 7 dias',
          version: { increment: 1 },
        }),
      });
      const evento = (auditoria.registrar as jest.Mock).mock.calls[0][1];
      expect(evento.camposAlterados).toEqual({ tratamento: { antes: null, depois: null } });
    });

    it('reenvio sem mudança real não incrementa a versão nem audita', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findFirst as jest.Mock).mockResolvedValue(criarAtendimentoFalso());
      const auditoria = auditoriaFalsa();
      const service = criarServico(prisma, auditoria);

      const resposta = await service.atualizar(
        ID_ANIMAL,
        ID_ATENDIMENTO,
        { versao: 1, anamnese: 'Resgatado na rua' },
        ESCOPO_ADMIN,
      );

      expect(resposta.versao).toBe(1);
      expect(prisma.atendimentoClinico.updateMany).not.toHaveBeenCalled();
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('rejeita versão desatualizada (409) sem gravar', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findFirst as jest.Mock).mockResolvedValue(
        criarAtendimentoFalso({ version: 3 }),
      );
      const service = criarServico(prisma);

      await expect(
        service.atualizar(ID_ANIMAL, ID_ATENDIMENTO, { versao: 1, tratamento: 'x' }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.atendimentoClinico.updateMany).not.toHaveBeenCalled();
    });

    it('rejeita edição concorrente que vence entre a leitura e a escrita', async () => {
      const prisma = criarPrismaFalso();
      (prisma.atendimentoClinico.findFirst as jest.Mock).mockResolvedValue(
        criarAtendimentoFalso(),
      );
      (prisma.atendimentoClinico.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const service = criarServico(prisma);

      await expect(
        service.atualizar(ID_ANIMAL, ID_ATENDIMENTO, { versao: 1, tratamento: 'x' }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('exige ao menos um campo além da versão', async () => {
      const prisma = criarPrismaFalso();
      const service = criarServico(prisma);

      await expect(
        service.atualizar(ID_ANIMAL, ID_ATENDIMENTO, { versao: 1 }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
