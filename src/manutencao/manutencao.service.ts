import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SituacaoFoto } from '@prisma/client';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

const HORA = 60 * 60 * 1000;
/** Pendente: folga depois do prazo de envio, para não apagar um upload lento em andamento. */
export const HORAS_TOLERANCIA_PENDENTE = 24;
/** Confirmada sem ficha: o app pode ter ficado offline entre a foto e o cadastro. */
export const DIAS_FOTO_SEM_FICHA = 30;

export interface ResultadoManutencao {
  fotosPendentesRemovidas: number;
  fotosSemFichaRemovidas: number;
  chavesRemovidas: number;
  falhasNoStorage: number;
}

@Injectable()
export class ManutencaoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ManutencaoService.name);
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly idempotencia: IdempotenciaService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap() {
    const horas = Number(this.config.get('MANUTENCAO_INTERVALO_HORAS') ?? 6);
    if (this.config.get('NODE_ENV') === 'test' || horas <= 0) return;
    this.temporizador = setInterval(() => void this.executarComLog(), horas * HORA);
    this.temporizador.unref();
  }

  onApplicationShutdown() {
    if (this.temporizador) clearInterval(this.temporizador);
  }

  private async executarComLog() {
    try {
      this.logger.log(`Manutenção: ${JSON.stringify(await this.executar())}`);
    } catch (erro) {
      this.logger.error(`Manutenção falhou: ${(erro as Error).message}`);
    }
  }

  /**
   * Idempotente e segura contra corrida com a confirmação/cadastro: a condição de "órfã" é
   * conferida de novo no próprio DELETE. A tarefa de Storage é gravada na mesma transação:
   * uma falha de rede não perde a referência e a próxima execução tenta novamente.
   */
  async executar(agora = new Date()): Promise<ResultadoManutencao> {
    const limitePendente = new Date(agora.getTime() - HORAS_TOLERANCIA_PENDENTE * HORA);
    const limiteSemFicha = new Date(agora.getTime() - DIAS_FOTO_SEM_FICHA * 24 * HORA);
    const resultado: ResultadoManutencao = {
      fotosPendentesRemovidas: 0,
      fotosSemFichaRemovidas: 0,
      chavesRemovidas: 0,
      falhasNoStorage: 0,
    };

    const criterios = [
      {
        campo: 'fotosPendentesRemovidas' as const,
        where: { situacao: SituacaoFoto.PENDENTE, expiraEm: { lt: limitePendente }, animal: null },
      },
      {
        campo: 'fotosSemFichaRemovidas' as const,
        where: {
          situacao: SituacaoFoto.CONFIRMADA,
          updatedAt: { lt: limiteSemFicha },
          animal: null,
        },
      },
    ];

    for (const { campo, where } of criterios) {
      const candidatas = await this.prisma.foto.findMany({
        where,
        select: { id: true, caminhoArmazenamento: true },
        take: 500,
      });
      for (const foto of candidatas) {
        const count = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${foto.id}, 0))`;
          const { count } = await tx.foto.deleteMany({ where: { id: foto.id, ...where } });
          if (count > 0) {
            await tx.remocaoArquivo.upsert({
              where: { caminhoArmazenamento: foto.caminhoArmazenamento },
              create: { fotoId: foto.id, caminhoArmazenamento: foto.caminhoArmazenamento },
              update: {},
            });
          }
          return count;
        });
        if (count === 0) continue; // virou ficha (ou foi confirmada) no meio do caminho
        resultado[campo]++;
      }
    }

    const tarefas = await this.prisma.remocaoArquivo.findMany({
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    for (const tarefa of tarefas) {
      try {
        await this.storage.removerArquivo(tarefa.caminhoArmazenamento);
        await this.prisma.remocaoArquivo.deleteMany({ where: { id: tarefa.id } });
      } catch {
        resultado.falhasNoStorage++;
        // Mensagem fixa, sem resposta do fornecedor que possa conter segredo/link.
        await this.prisma.remocaoArquivo.updateMany({
          where: { id: tarefa.id },
          data: {
            tentativas: { increment: 1 },
            ultimaTentativaEm: agora,
            ultimoErro: 'Falha ao remover arquivo do armazenamento',
          },
        });
      }
    }

    resultado.chavesRemovidas = await this.idempotencia.limparExpiradas(agora);
    return resultado;
  }
}
