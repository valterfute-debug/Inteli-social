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
});
