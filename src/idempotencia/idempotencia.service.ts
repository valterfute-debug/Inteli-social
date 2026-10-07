import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ChaveIdempotencia, Prisma } from '@prisma/client';
import { isUUID } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

/** Tempo que uma chave fica guardada: precisa ser maior que o maior período offline esperado. */
export const DIAS_RETENCAO_CHAVES = 30;

export interface ContextoIdempotencia {
  usuarioId: string;
  chave: string;
  /** Rota da operação, ex.: "POST /animals". A mesma chave em outra rota é conflito. */
  operacao: string;
  /** Corpo (e parâmetros) da requisição; comparado por hash para detectar reuso indevido. */
  conteudo: unknown;
}

export interface ResultadoIdempotente<T> {
  recursoId: string;
  /** Presente só na primeira execução; num reenvio o chamador relê o recurso. */
  resultado?: T;
  reenvio: boolean;
}

/** Valida o cabeçalho Idempotency-Key (UUID v4). Devolve undefined se opcional e ausente. */
export function lerChaveIdempotencia(valor: string | undefined, obrigatoria: true): string;
export function lerChaveIdempotencia(
  valor: string | undefined,
  obrigatoria: false,
): string | undefined;
export function lerChaveIdempotencia(valor: string | undefined, obrigatoria: boolean) {
  if (valor === undefined && !obrigatoria) return undefined;
  if (!valor || !isUUID(valor, '4')) {
    throw new BadRequestException('Cabeçalho Idempotency-Key ausente ou inválido');
  }
  return valor.toLowerCase();
}

/** JSON com as chaves ordenadas: a ordem dos campos no corpo não muda o hash. */
function canonico(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(canonico);
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(
      Object.keys(valor as Record<string, unknown>)
        .sort()
        .filter((chave) => (valor as Record<string, unknown>)[chave] !== undefined)
        .map((chave) => [chave, canonico((valor as Record<string, unknown>)[chave])]),
    );
  }
  return valor;
}

export function hashConteudo(operacao: string, conteudo: unknown) {
  const normalizado = JSON.stringify(
    canonico({ operacao, conteudo: JSON.parse(JSON.stringify(conteudo ?? null)) }),
  );
  return createHash('sha256').update(normalizado).digest('hex');
}

class ChaveJaRegistrada extends Error {}

@Injectable()
export class IdempotenciaService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reenvio já processado? Devolve o id do recurso criado na primeira vez, null se a chave
   * é nova, ou 409 se a chave já foi usada com outro conteúdo/operação.
   */
  async verificarReenvio(ctx: ContextoIdempotencia): Promise<string | null> {
    const registro = await this.prisma.chaveIdempotencia.findUnique({
      where: { usuarioId_chave: { usuarioId: ctx.usuarioId, chave: ctx.chave } },
    });
    return registro ? this.reaproveitar(registro, ctx) : null;
  }

  /**
   * Executa a escrita e grava a chave NA MESMA TRANSAÇÃO: se a resposta se perder depois do
   * commit, o reenvio encontra a chave; se a transação falhar, nada fica gravado.
   * A chave é inserida antes da escrita: uma segunda requisição concorrente com a mesma
   * chave espera no índice único e, quando a primeira confirma, desiste sem escrever nada.
   */
  async executar<T>(
    ctx: ContextoIdempotencia,
    escrever: (tx: Prisma.TransactionClient) => Promise<{ recursoId: string; resultado: T }>,
  ): Promise<ResultadoIdempotente<T>> {
    const anterior = await this.verificarReenvio(ctx);
    if (anterior) return { recursoId: anterior, reenvio: true };

    try {
      const { recursoId, resultado } = await this.prisma.$transaction(async (tx) => {
        try {
          await tx.chaveIdempotencia.create({
            data: {
              usuarioId: ctx.usuarioId,
              chave: ctx.chave,
              operacao: ctx.operacao,
              hashConteudo: hashConteudo(ctx.operacao, ctx.conteudo),
              recursoId: '',
            },
          });
        } catch (erro) {
          if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
            throw new ChaveJaRegistrada();
          }
          throw erro;
        }
        const escrito = await escrever(tx);
        await tx.chaveIdempotencia.update({
          where: { usuarioId_chave: { usuarioId: ctx.usuarioId, chave: ctx.chave } },
          data: { recursoId: escrito.recursoId },
        });
        return escrito;
      });
      return { recursoId, resultado, reenvio: false };
    } catch (erro) {
      if (!(erro instanceof ChaveJaRegistrada)) throw erro;
      // Perdeu a corrida para uma requisição igual que já confirmou.
      const vencedora = await this.verificarReenvio(ctx);
      if (!vencedora)
        throw new ConflictException('Requisição repetida em processamento; tente novamente');
      return { recursoId: vencedora, reenvio: true };
    }
  }

  /**
   * Para operações já idempotentes pelo próprio id (ex.: foto com id gerado pelo cliente):
   * só registra a chave e acusa reuso com conteúdo diferente.
   */
  async registrar(ctx: ContextoIdempotencia, recursoId: string) {
    if (await this.verificarReenvio(ctx)) return;
    try {
      await this.prisma.chaveIdempotencia.create({
        data: {
          usuarioId: ctx.usuarioId,
          chave: ctx.chave,
          operacao: ctx.operacao,
          hashConteudo: hashConteudo(ctx.operacao, ctx.conteudo),
          recursoId,
        },
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        await this.verificarReenvio(ctx);
        return;
      }
      throw erro;
    }
  }

  /** Remove chaves mais antigas que a retenção. Chamado pela rotina de manutenção. */
  async limparExpiradas(agora = new Date()) {
    const limite = new Date(agora.getTime() - DIAS_RETENCAO_CHAVES * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.chaveIdempotencia.deleteMany({
      where: { createdAt: { lt: limite } },
    });
    return count;
  }

  private reaproveitar(registro: ChaveIdempotencia, ctx: ContextoIdempotencia) {
    if (
      registro.operacao !== ctx.operacao ||
      registro.hashConteudo !== hashConteudo(ctx.operacao, ctx.conteudo)
    ) {
      throw new ConflictException(
        'Idempotency-Key já usada em outra requisição com conteúdo diferente',
      );
    }
    return registro.recursoId;
  }
}
