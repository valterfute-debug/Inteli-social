import { randomUUID } from 'node:crypto';
import { PapelUsuario, SituacaoFoto } from '@prisma/client';
import { ManutencaoService } from '../../src/manutencao/manutencao.service';
import { criarAmbienteE2E, storageSimulado } from './app-e2e';

/** Issue #3, P1-1: limpeza de fotos órfãs e chaves antigas, sem tocar no que está em uso. */
describe('Manutenção (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  const agora = new Date('2026-12-01T12:00:00.000Z');
  const horasAtras = (h: number) => new Date(agora.getTime() - h * 60 * 60 * 1000);

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    await ambiente.usuario('dono', PapelUsuario.ADMIN);
  });
  afterAll(async () => {
    await ambiente.encerrar();
  });

  async function foto(situacao: SituacaoFoto, expiraEm: Date, atualizadaEm = expiraEm) {
    const id = randomUUID();
    await ambiente.prisma.foto.create({
      data: {
        id,
        tipoMidia: 'image/jpeg',
        tamanhoBytes: 1000,
        caminhoArmazenamento: `admissao/${id}.jpg`,
        situacao,
        expiraEm,
        criadoPorId: 'dono',
        updatedAt: atualizadaEm,
      },
    });
    return id;
  }

  it('remove só as órfãs vencidas, apaga o arquivo delas e limpa chaves antigas', async () => {
    const { prisma } = ambiente;
    const pendenteVencida = await foto(SituacaoFoto.PENDENTE, horasAtras(48));
    const pendenteRecente = await foto(SituacaoFoto.PENDENTE, horasAtras(2));
    const semFichaAntiga = await foto(SituacaoFoto.CONFIRMADA, horasAtras(24 * 40));
    const semFichaRecente = await foto(SituacaoFoto.CONFIRMADA, horasAtras(24 * 5));
    const vinculada = await foto(SituacaoFoto.CONFIRMADA, horasAtras(24 * 40));

    const casAdote = await ambiente.idUnidade('CasAdote');
    await prisma.animal.create({
      data: {
        id: randomUUID(),
        publicId: 'AM-TESTE-0001',
        speciesId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
        unitId: casAdote,
        locationId: (
          await prisma.location.findUniqueOrThrow({
            where: { unitId_name: { unitId: casAdote, name: 'Canil' } },
          })
        ).id,
        responsibleId: (await prisma.responsible.findFirstOrThrow()).id,
        front: 'CASADOTE',
        fotoEntradaId: vinculada,
      },
    });
    await prisma.chaveIdempotencia.createMany({
      data: [
        {
          usuarioId: 'dono',
          chave: randomUUID(),
          operacao: 'X',
          hashConteudo: 'h',
          recursoId: 'r',
          createdAt: horasAtras(24 * 31),
        },
        {
          usuarioId: 'dono',
          chave: randomUUID(),
          operacao: 'X',
          hashConteudo: 'h',
          recursoId: 'r',
          createdAt: horasAtras(24 * 2),
        },
      ],
    });
    const removidos: string[] = [];
    const original = storageSimulado.removerArquivo;
    storageSimulado.removerArquivo = async (caminho?: string) => {
      removidos.push(caminho as string);
    };

    try {
      const resultado = await ambiente.app.get(ManutencaoService).executar(agora);

      expect(resultado).toEqual({
        fotosPendentesRemovidas: 1,
        fotosSemFichaRemovidas: 1,
        chavesRemovidas: 1,
        falhasNoStorage: 0,
      });
      const restantes = (await prisma.foto.findMany({ select: { id: true } })).map((f) => f.id);
      expect(restantes.sort()).toEqual([pendenteRecente, semFichaRecente, vinculada].sort());
      expect(removidos.sort()).toEqual(
        [`admissao/${pendenteVencida}.jpg`, `admissao/${semFichaAntiga}.jpg`].sort(),
      );
      // Rodar de novo não faz nada (idempotente).
      expect(
        (await ambiente.app.get(ManutencaoService).executar(agora)).fotosPendentesRemovidas,
      ).toBe(0);
    } finally {
      storageSimulado.removerArquivo = original;
    }
  });

  it('falha do Storage mantém tarefa durável e a próxima execução repete a remoção', async () => {
    const id = await foto(SituacaoFoto.PENDENTE, horasAtras(48));
    const caminhoArmazenamento = `admissao/${id}.jpg`;
    const original = storageSimulado.removerArquivo;
    const remover = jest
      .fn()
      .mockRejectedValueOnce(new Error('Storage indisponível'))
      .mockResolvedValue(undefined);
    storageSimulado.removerArquivo = remover;
    try {
      const service = ambiente.app.get(ManutencaoService);
      const primeira = await service.executar(agora);
      expect(primeira.fotosPendentesRemovidas).toBe(1);
      expect(primeira.falhasNoStorage).toBe(1);
      expect(await ambiente.prisma.foto.findUnique({ where: { id } })).toBeNull();
      const tarefa = await ambiente.prisma.remocaoArquivo.findUniqueOrThrow({
        where: { caminhoArmazenamento },
      });
      expect(tarefa.fotoId).toBe(id);
      expect(tarefa.tentativas).toBe(1);
      const segunda = await service.executar(agora);
      expect(segunda.fotosPendentesRemovidas).toBe(0);
      expect(segunda.falhasNoStorage).toBe(0);
      expect(remover).toHaveBeenCalledTimes(2);
      expect(remover).toHaveBeenLastCalledWith(caminhoArmazenamento);
      expect(
        await ambiente.prisma.remocaoArquivo.findUnique({ where: { caminhoArmazenamento } }),
      ).toBeNull();
    } finally {
      storageSimulado.removerArquivo = original;
    }
  });
});
