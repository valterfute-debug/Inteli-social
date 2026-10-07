import { CHAVE_TESTE, idempotenciaFalsa } from '../../test/idempotencia-teste';
import { ESCOPO_ADMIN } from '../../test/escopos-teste';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Front, Porte, Prisma, SituacaoFoto, Sexo } from '@prisma/client';
import { AnimalsService } from './animals.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { CriarAnimalDto } from './dto/criar-animal.dto';

const ID_ANIMAL = 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1';

function criarAnimalFalso(sobrescritas: Partial<Record<string, unknown>> = {}) {
  return {
    id: ID_ANIMAL,
    name: 'Rex',
    publicId: 'QA-001',
    microchip: null,
    dataEntrada: null,
    sexo: Sexo.MACHO,
    idadeAproximadaMeses: null,
    pesoKg: null,
    porte: null,
    cor: null,
    observacoes: null,
    fotoEntradaId: 'foto-1',
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
    species: { id: 'especie-1', name: 'Cão', silvestre: false },
    unit: { id: 'unidade-1', name: 'CasAdote' },
    location: { id: 'local-1', name: 'Canil' },
    fotoEntrada: {
      id: 'foto-1',
      situacao: SituacaoFoto.CONFIRMADA,
      caminhoArmazenamento: 'admissao/foto-1.jpg',
    },
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
    species: {
      findFirst: jest.fn().mockResolvedValue({ silvestre: false }),
    },
    foto: {
      findUnique: jest.fn().mockResolvedValue({ id: 'foto-1', situacao: SituacaoFoto.CONFIRMADA }),
    },
  } as unknown as PrismaService;
}

function criarStorageFalso() {
  return {
    criarUrlsLeitura: jest
      .fn()
      .mockResolvedValue(new Map([['admissao/foto-1.jpg', 'https://exemplo.invalid/foto-1']])),
  } as unknown as SupabaseStorageService;
}

const BASE_CASADOTE: CriarAnimalDto = {
  especieId: 'especie-1',
  unidadeId: 'unidade-1',
  localizacaoId: 'local-1',
  responsavelId: 'responsavel-1',
  frente: Front.CASADOTE,
  fotoEntradaId: 'foto-1',
};

const COMPLETO_CCPA: CriarAnimalDto = {
  ...BASE_CASADOTE,
  frente: Front.CCPA,
  microchip: '000123456789',
  sexo: Sexo.FEMEA,
  idadeAproximadaMeses: 24,
  pesoKg: 12.5,
  porte: Porte.MEDIO,
};

describe('AnimalsService', () => {
  describe('criar', () => {
    it('cria um animal e devolve a resposta com nomes das relações e URL da foto', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.create as jest.Mock).mockResolvedValue(criarAnimalFalso());
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      const { animal: resposta } = await service.criar(
        { ...BASE_CASADOTE, nome: 'Rex', sexo: Sexo.MACHO },
        ESCOPO_ADMIN,
        CHAVE_TESTE,
      );

      expect(resposta?.identificadorPublico).toBe('QA-001');
      expect(resposta?.versao).toBe(1);
      expect(resposta?.especieNome).toBe('Cão');
      expect(resposta?.unidadeNome).toBe('CasAdote');
      expect(resposta?.fotoEntradaUrl).toBe('https://exemplo.invalid/foto-1');
    });

    it('exige microchip, sexo, idade, peso e porte na frente CCPA', async () => {
      const prisma = criarPrismaFalso();
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      const erro = await service
        .criar({ ...BASE_CASADOTE, frente: Front.CCPA }, ESCOPO_ADMIN, CHAVE_TESTE)
        .catch((e) => e);

      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.getResponse().message).toHaveLength(5);
      expect(prisma.animal.create).not.toHaveBeenCalled();
    });

    it('aceita cadastro completo na frente CCPA', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.animal.create as jest.Mock).mockResolvedValue(
        criarAnimalFalso({ front: Front.CCPA, microchip: '000123456789' }),
      );
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      const { animal: resposta } = await service.criar(COMPLETO_CCPA, ESCOPO_ADMIN, CHAVE_TESTE);

      expect(resposta?.microchip).toBe('000123456789');
    });

    it('exige nome para espécie silvestre e dispensa microchip mesmo em CED', async () => {
      const prisma = criarPrismaFalso();
      (prisma.species.findFirst as jest.Mock).mockResolvedValue({ silvestre: true });
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.criar({ ...BASE_CASADOTE, frente: Front.CED }, ESCOPO_ADMIN, CHAVE_TESTE),
      ).rejects.toBeInstanceOf(BadRequestException);

      (prisma.animal.create as jest.Mock).mockResolvedValue(
        criarAnimalFalso({ name: 'Onça Pintada' }),
      );
      await expect(
        service.criar(
          { ...BASE_CASADOTE, frente: Front.CED, nome: 'Onça Pintada' },
          ESCOPO_ADMIN,
          CHAVE_TESTE,
        ),
      ).resolves.toBeDefined();
    });

    it('rejeita espécie inexistente com 400', async () => {
      const prisma = criarPrismaFalso();
      (prisma.species.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(service.criar(BASE_CASADOTE, ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('devolve 409 com o animal existente quando o microchip já está cadastrado', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue({
        id: ID_ANIMAL,
        publicId: 'AM-2026-AAAA',
      });
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      const erro = await service.criar(COMPLETO_CCPA, ESCOPO_ADMIN, CHAVE_TESTE).catch((e) => e);

      expect(erro).toBeInstanceOf(ConflictException);
      expect(erro.getResponse().detalhes).toEqual({
        animalExistenteId: ID_ANIMAL,
        identificadorPublico: 'AM-2026-AAAA',
      });
      expect(prisma.animal.create).not.toHaveBeenCalled();
    });

    it('converte violação de identificador público duplicado em 409', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.create as jest.Mock).mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(service.criar(BASE_CASADOTE, ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejeita cadastro quando a foto ainda não foi confirmada', async () => {
      const prisma = criarPrismaFalso();
      (prisma.foto.findUnique as jest.Mock).mockResolvedValue({
        id: 'foto-1',
        situacao: SituacaoFoto.PENDENTE,
      });
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(service.criar(BASE_CASADOTE, ESCOPO_ADMIN, CHAVE_TESTE)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.animal.create).not.toHaveBeenCalled();
    });

    it('rejeita cadastro quando a foto informada não existe', async () => {
      const prisma = criarPrismaFalso();
      (prisma.foto.findUnique as jest.Mock).mockResolvedValue(null);
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.criar(
          { ...BASE_CASADOTE, fotoEntradaId: 'foto-inexistente' },
          ESCOPO_ADMIN,
          CHAVE_TESTE,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('listar', () => {
    it('busca livre procura em nome, identificador público e microchip', () => {
      const service = new AnimalsService(
        criarPrismaFalso(),
        criarStorageFalso(),
        idempotenciaFalsa(null),
      );

      const where = service.montarFiltroListagem({ pagina: 1, limite: 20, busca: 'rex' });

      expect(where.deletedAt).toBeNull();
      expect(where.OR).toEqual([
        { name: { contains: 'rex', mode: 'insensitive' } },
        { publicId: { contains: 'rex', mode: 'insensitive' } },
        { microchip: { startsWith: 'rex' } },
      ]);
    });

    it('combina filtros de espécie, frente, unidade e microchip', () => {
      const service = new AnimalsService(
        criarPrismaFalso(),
        criarStorageFalso(),
        idempotenciaFalsa(null),
      );

      const where = service.montarFiltroListagem({
        pagina: 1,
        limite: 20,
        especieId: 'especie-1',
        frente: Front.CED,
        unidadeId: 'unidade-1',
        microchip: '123',
      });

      expect(where).toMatchObject({
        speciesId: 'especie-1',
        front: Front.CED,
        unitId: 'unidade-1',
        microchip: '123',
      });
      expect(where.OR).toBeUndefined();
    });

    it('gera as URLs das fotos em uma única chamada ao armazenamento', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findMany as jest.Mock).mockResolvedValue([
        criarAnimalFalso(),
        criarAnimalFalso(),
      ]);
      (prisma.animal.count as jest.Mock).mockResolvedValue(2);
      const storage = criarStorageFalso();
      const service = new AnimalsService(prisma, storage, idempotenciaFalsa(prisma));

      const resposta = await service.listar({ pagina: 1, limite: 20 }, ESCOPO_ADMIN);

      expect(storage.criarUrlsLeitura).toHaveBeenCalledTimes(1);
      expect(resposta.itens[0].fotoEntradaUrl).toBe('https://exemplo.invalid/foto-1');
      expect(resposta.total).toBe(2);
    });

    it('lista mesmo quando o armazenamento de fotos falha (sem URL)', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findMany as jest.Mock).mockResolvedValue([criarAnimalFalso()]);
      (prisma.animal.count as jest.Mock).mockResolvedValue(1);
      const storage = criarStorageFalso();
      (storage.criarUrlsLeitura as jest.Mock).mockRejectedValue(new Error('Storage fora do ar'));
      const service = new AnimalsService(prisma, storage, idempotenciaFalsa(prisma));

      const resposta = await service.listar({ pagina: 1, limite: 20 }, ESCOPO_ADMIN);

      expect(resposta.itens[0].fotoEntradaUrl).toBeNull();
    });
  });

  describe('atualizar', () => {
    it('permite transferir de CED para CasAdote enviando só frente e local', async () => {
      const prisma = criarPrismaFalso();
      const completoCed = criarAnimalFalso({
        front: Front.CED,
        microchip: '000123456789',
        idadeAproximadaMeses: 24,
        pesoKg: new Prisma.Decimal(12.5),
        porte: Porte.MEDIO,
      });
      (prisma.animal.findFirst as jest.Mock)
        .mockResolvedValueOnce(completoCed)
        .mockResolvedValueOnce({ ...completoCed, front: Front.CASADOTE, version: 2 });
      (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      const resposta = await service.atualizar(
        ID_ANIMAL,
        {
          versao: 1,
          frente: Front.CASADOTE,
          unidadeId: 'unidade-1',
          localizacaoId: 'local-1',
        },
        ESCOPO_ADMIN,
      );

      expect(resposta?.frente).toBe(Front.CASADOTE);
    });

    it('aplica as regras sobre o estado final: mover para CCPA sem microchip é rejeitado', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalFalso());
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.atualizar(ID_ANIMAL, { versao: 1, frente: Front.CCPA }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.animal.updateMany).not.toHaveBeenCalled();
    });

    it('rejeita versão desatualizada com 409 sem tentar gravar', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalFalso({ version: 3 }));
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.atualizar(ID_ANIMAL, { versao: 1, nome: 'Novo nome' }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.animal.updateMany).not.toHaveBeenCalled();
    });

    it('rejeita com 409 quando outra edição grava entre a leitura e a escrita', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalFalso());
      (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.atualizar(ID_ANIMAL, { versao: 1, nome: 'Novo nome' }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('retorna 404 ao tentar atualizar animal inexistente', async () => {
      const prisma = criarPrismaFalso();
      (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
      const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

      await expect(
        service.atualizar('id-inexistente', { versao: 1, nome: 'Novo nome' }, ESCOPO_ADMIN),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('retorna 404 ao arquivar animal inexistente', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    const service = new AnimalsService(prisma, criarStorageFalso(), idempotenciaFalsa(prisma));

    await expect(service.arquivar('id-inexistente', ESCOPO_ADMIN)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
