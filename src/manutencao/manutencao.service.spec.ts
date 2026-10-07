import { ConfigService } from '@nestjs/config';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { ManutencaoService } from './manutencao.service';

describe('ManutencaoService', () => {
  it('mantém tarefa após falha de Storage e tenta de novo sem depender da linha Foto removida', async () => {
    const candidata = { id: 'foto-expirada', caminhoArmazenamento: 'admissao/foto-expirada.jpg' };
    let fotoExiste = true;
    let tarefaExiste = false;
    const prisma = {
      foto: {
        findMany: jest.fn(async () => (fotoExiste ? [candidata] : [])),
        deleteMany: jest.fn(async () => {
          fotoExiste = false;
          return { count: 1 };
        }),
      },
      remocaoArquivo: {
        upsert: jest.fn(async () => {
          tarefaExiste = true;
          return {};
        }),
        findMany: jest.fn(async () =>
          tarefaExiste
            ? [
                {
                  id: 'tarefa',
                  fotoId: candidata.id,
                  caminhoArmazenamento: candidata.caminhoArmazenamento,
                },
              ]
            : [],
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn(async () => {
          tarefaExiste = false;
          return { count: 1 };
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(),
    };
    prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    const removerArquivo = jest
      .fn()
      .mockRejectedValueOnce(new Error('indisponível'))
      .mockResolvedValue(undefined);
    const service = new ManutencaoService(
      prisma as unknown as PrismaService,
      { removerArquivo } as unknown as SupabaseStorageService,
      { limparExpiradas: jest.fn().mockResolvedValue(0) } as unknown as IdempotenciaService,
      { get: () => undefined } as unknown as ConfigService,
    );
    const primeira = await service.executar();
    expect(primeira.fotosPendentesRemovidas).toBe(1);
    expect(primeira.falhasNoStorage).toBe(1);
    expect(fotoExiste).toBe(false);
    expect(tarefaExiste).toBe(true);
    expect(prisma.remocaoArquivo.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tentativas: { increment: 1 } }),
      }),
    );
    const segunda = await service.executar();
    expect(segunda.fotosPendentesRemovidas).toBe(0);
    expect(segunda.falhasNoStorage).toBe(0);
    expect(removerArquivo).toHaveBeenCalledTimes(2);
    expect(prisma.foto.deleteMany).toHaveBeenCalledTimes(1);
    expect(tarefaExiste).toBe(false);
  });
});
