import { CatalogosService } from './catalogos.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CatalogosService', () => {
  it('lista as três frentes fixas de atuação', () => {
    const service = new CatalogosService({} as PrismaService);
    const resposta = service.listarFrentes({ pagina: 1, limite: 20 });

    expect(resposta.total).toBe(3);
    expect(resposta.itens.map((item) => item.codigo)).toEqual(['CCPA', 'CASADOTE', 'CED']);
  });

  it('pagina a listagem de frentes corretamente', () => {
    const service = new CatalogosService({} as PrismaService);
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
    const service = new CatalogosService(prisma);

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
    const service = new CatalogosService({ responsible: { create } } as unknown as PrismaService);

    const resposta = await service.criarResponsavel({
      nome: '  Maria ',
      email: 'maria@exemplo.invalid',
    });

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
});
