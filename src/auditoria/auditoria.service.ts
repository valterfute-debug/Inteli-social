import { Injectable } from '@nestjs/common';
import { Front, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { requisicaoAtualId } from '../requisicao/contexto-requisicao';
import { ListarAuditoriaQueryDto } from './dto/listar-auditoria-query.dto';

export enum AcaoAuditoria {
  ANIMAL_CRIADO = 'ANIMAL_CRIADO',
  ANIMAL_ATUALIZADO = 'ANIMAL_ATUALIZADO',
  ANIMAL_ARQUIVADO = 'ANIMAL_ARQUIVADO',
  EVENTO_SAUDE_CRIADO = 'EVENTO_SAUDE_CRIADO',
  EVENTO_SAUDE_ARQUIVADO = 'EVENTO_SAUDE_ARQUIVADO',
  FOTO_CONFIRMADA = 'FOTO_CONFIRMADA',
  RESPONSAVEL_CRIADO = 'RESPONSAVEL_CRIADO',
}

export interface DadosEventoAuditoria {
  usuarioId: string;
  acao: AcaoAuditoria;
  entidade: 'Animal' | 'HealthEvent' | 'Foto' | 'Responsible';
  entidadeId: string;
  unidadeId?: string | null;
  frente?: Front | null;
  camposAlterados?: Record<string, { antes: unknown; depois: unknown }> | null;
}

/** Valores comparáveis e serializáveis (Decimal, Date). */
function normalizar(valor: unknown): unknown {
  if (valor instanceof Prisma.Decimal) return valor.toNumber();
  if (valor instanceof Date) return valor.toISOString();
  return valor ?? null;
}

/**
 * Campos que realmente mudaram, no formato { campo: { antes, depois } }.
 * `novos` usa os nomes das colunas do banco; campos ausentes (undefined) não mudaram.
 */
export function calcularCamposAlterados(
  atual: Record<string, unknown>,
  novos: Record<string, unknown>,
): Record<string, { antes: unknown; depois: unknown }> {
  const alterados: Record<string, { antes: unknown; depois: unknown }> = {};
  for (const [campo, valorNovo] of Object.entries(novos)) {
    if (valorNovo === undefined) continue;
    const antes = normalizar(atual[campo]);
    const depois = normalizar(valorNovo);
    if (JSON.stringify(antes) !== JSON.stringify(depois)) alterados[campo] = { antes, depois };
  }
  return alterados;
}

@Injectable()
export class AuditoriaService {
  constructor(private readonly prisma: PrismaService) {}

  /** Grava o evento na transação da própria escrita: sem escrita sem auditoria, e vice-versa. */
  async registrar(tx: Prisma.TransactionClient, dados: DadosEventoAuditoria) {
    await tx.eventoAuditoria.create({
      data: {
        usuarioId: dados.usuarioId,
        acao: dados.acao,
        entidade: dados.entidade,
        entidadeId: dados.entidadeId,
        unidadeId: dados.unidadeId ?? null,
        frente: dados.frente ?? null,
        camposAlterados:
          dados.camposAlterados && Object.keys(dados.camposAlterados).length > 0
            ? (dados.camposAlterados as Prisma.InputJsonValue)
            : Prisma.DbNull,
        requisicaoId: requisicaoAtualId() ?? null,
      },
    });
  }

  async listar(query: ListarAuditoriaQueryDto) {
    const { pagina, limite, entidade, entidadeId, usuarioId, requisicaoId } = query;
    const where: Prisma.EventoAuditoriaWhereInput = {
      ...(entidade ? { entidade } : {}),
      ...(entidadeId ? { entidadeId } : {}),
      ...(usuarioId ? { usuarioId } : {}),
      ...(requisicaoId ? { requisicaoId } : {}),
    };
    const [itens, total] = await Promise.all([
      this.prisma.eventoAuditoria.findMany({
        where,
        orderBy: [{ instante: 'desc' }, { id: 'asc' }],
        skip: (pagina - 1) * limite,
        take: limite,
      }),
      this.prisma.eventoAuditoria.count({ where }),
    ]);
    return {
      itens: itens.map((evento) => ({ ...evento, instante: evento.instante.toISOString() })),
      pagina,
      limite,
      total,
    };
  }
}
