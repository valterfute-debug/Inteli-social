import { BadRequestException, NotFoundException } from '@nestjs/common';
import { USUARIO_TESTE } from '../../test/usuarios-teste';
import { auditoriaFalsa, comTransacao } from '../../test/auditoria-teste';
import { CatalogosService } from './catalogos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CatalogosService', () => {
  it('lista as três frentes fixas de atuação', () => {
    const service = new CatalogosService(comTransacao({} as PrismaService), auditoriaFalsa());
    const resposta = service.listarFrentes({ pagina: 1, limite: 20 });

    expect(resposta.total).toBe(3);
    expect(resposta.itens.map((item) => item.codigo)).toEqual(['CCPA', 'CASADOTE', 'CED']);
  });

  it('pagina a listagem de frentes corretamente', () => {
    const service = new CatalogosService(comTransacao({} as PrismaService), auditoriaFalsa());
    const resposta = service.listarFrentes({ pagina: 2, limite: 2 });

    expect(resposta.itens).toHaveLength(1);
    expect(resposta.pagina).toBe(2);
  });

  it('lista espécies informando se são silvestres', async () => {
    const prisma = {
      species: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'e1', name: 'Onça-pintada', silvestre: true }]),
        count: jest.fn().mockResolvedValue(1),
      },
    } as unknown as PrismaService;
    const service = new CatalogosService(comTransacao(prisma), auditoriaFalsa());

    const resposta = await service.listarEspecies({ pagina: 1, limite: 20 });

    expect(resposta.itens).toEqual([{ id: 'e1', nome: 'Onça-pintada', silvestre: true }]);
  });

  it('cadastra responsável com nome sem espaços nas pontas', async () => {
    const create = jest.fn().mockResolvedValue({
      id: 'r1',
      name: 'Maria',
      endereco: null,
      email: 'maria@exemplo.invalid',
      telefone: null,
    });
    const service = new CatalogosService(
      comTransacao({ responsible: { create } } as unknown as PrismaService),
      auditoriaFalsa(),
    );

    const resposta = await service.criarResponsavel(
      {
        nome: '  Maria ',
        email: 'maria@exemplo.invalid',
      },
      USUARIO_TESTE,
    );

    expect(create).toHaveBeenCalledWith({
      data: {
        name: 'Maria',
        endereco: undefined,
        email: 'maria@exemplo.invalid',
        telefone: undefined,
      },
    });
    expect(resposta.id).toBe('r1');
  });

  it('recusa cadastrar responsável cujo nome fica vazio depois do trim', async () => {
    const create = jest.fn();
    const service = new CatalogosService(
      comTransacao({ responsible: { create } } as unknown as PrismaService),
      auditoriaFalsa(),
    );

    await expect(service.criarResponsavel({ nome: '   ' }, USUARIO_TESTE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it('atualiza o endereço do responsável e audita a alteração', async () => {
    const atual = { id: 'r1', name: 'Maria', endereco: null, email: null, telefone: null };
    const findFirst = jest.fn().mockResolvedValue(atual);
    const update = jest.fn().mockResolvedValue({ ...atual, endereco: 'Rua das Flores, 10' });
    const auditoria = auditoriaFalsa();
    const service = new CatalogosService(
      comTransacao({ responsible: { findFirst, update } } as unknown as PrismaService),
      auditoria,
    );

    const resposta = await service.atualizarResponsavel(
      'r1',
      { endereco: 'Rua das Flores, 10' },
      USUARIO_TESTE,
    );

    expect(update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        name: undefined,
        endereco: 'Rua das Flores, 10',
        email: undefined,
        telefone: undefined,
      },
    });
    expect(resposta.endereco).toBe('Rua das Flores, 10');
    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
  });

  it('recusa atualizar responsável inexistente ou sem campos', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new CatalogosService(
      comTransacao({ responsible: { findFirst } } as unknown as PrismaService),
      auditoriaFalsa(),
    );

    await expect(service.atualizarResponsavel('x', {}, USUARIO_TESTE)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.atualizarResponsavel('x', { nome: 'Ana' }, USUARIO_TESTE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  describe('responsáveis: mesmas permissões para toda conta ativa', () => {
    const responsavel = {
      id: 'r1',
      name: 'Maria',
      endereco: 'Rua das Flores, 10',
      email: 'maria@exemplo.invalid',
      telefone: '(11) 91234-5678',
    };

    it('a listagem traz nome, endereço e contato, sem diferença entre contas', async () => {
      const prisma = {
        responsible: {
          findMany: jest.fn().mockResolvedValue([responsavel]),
          count: jest.fn().mockResolvedValue(1),
        },
      } as unknown as PrismaService;
      const service = new CatalogosService(comTransacao(prisma), auditoriaFalsa());

      const resposta = await service.listarResponsaveis({ pagina: 1, limite: 20 });

      expect(resposta.itens[0]).toEqual({
        id: 'r1',
        nome: 'Maria',
        endereco: 'Rua das Flores, 10',
        email: 'maria@exemplo.invalid',
        telefone: '(11) 91234-5678',
      });
    });

    function prismaDoPatch() {
      return {
        responsible: {
          findFirst: jest.fn().mockResolvedValue(responsavel),
          update: jest.fn().mockResolvedValue({ ...responsavel, email: 'novo@exemplo.invalid' }),
        },
        // Qualquer consulta de vínculo com animais seria um resquício do escopo por unidade.
        animal: { count: jest.fn() },
      } as unknown as PrismaService;
    }

    it('qualquer conta edita qualquer responsável, sem consultar vínculo com unidade', async () => {
      const prisma = prismaDoPatch();
      const service = new CatalogosService(comTransacao(prisma), auditoriaFalsa());

      await service.atualizarResponsavel('r1', { email: 'novo@exemplo.invalid' }, USUARIO_TESTE);

      expect(prisma.responsible.update).toHaveBeenCalledTimes(1);
      expect(prisma.animal.count).not.toHaveBeenCalled();
    });

    it('a trilha de auditoria guarda só o nome dos campos, nunca e-mail ou telefone', async () => {
      const prisma = prismaDoPatch();
      const auditoria = auditoriaFalsa();
      const service = new CatalogosService(comTransacao(prisma), auditoria);

      await service.atualizarResponsavel('r1', { email: 'novo@exemplo.invalid' }, USUARIO_TESTE);

      const evento = (auditoria.registrar as jest.Mock).mock.calls[0][1];
      expect(evento.camposAlterados).toEqual({ email: { antes: null, depois: null } });
    });

    it('recusa nome que fica vazio depois de remover os espaços', async () => {
      const service = new CatalogosService(comTransacao({} as PrismaService), auditoriaFalsa());

      await expect(
        service.atualizarResponsavel('r1', { nome: '   ' }, USUARIO_TESTE),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
