import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RequisicaoAutenticada } from '../auth/tipos';

interface ContextoRequisicao {
  requisicaoId: string;
}

const armazenamento = new AsyncLocalStorage<ContextoRequisicao>();

/** ID da requisição em andamento (para logs e auditoria), ou undefined fora de uma requisição. */
export function requisicaoAtualId(): string | undefined {
  return armazenamento.getStore()?.requisicaoId;
}

/** Aceita o ID enviado pelo cliente só se for seguro para log (evita injeção de texto). */
export function resolverRequisicaoId(enviado: string | undefined): string {
  return enviado && /^[A-Za-z0-9_-]{8,64}$/.test(enviado) ? enviado : randomUUID();
}

/**
 * Dá a cada requisição um ID de correlação: devolvido em X-Request-Id, presente no log de
 * acesso, no log de erro, no corpo de erro e nos eventos de auditoria.
 */
export function middlewareContextoRequisicao(logger = new Logger('HTTP')) {
  return (requisicao: Request, resposta: Response, proximo: NextFunction) => {
    const requisicaoId = resolverRequisicaoId(requisicao.header('x-request-id'));
    resposta.setHeader('X-Request-Id', requisicaoId);
    const inicio = process.hrtime.bigint();

    resposta.on('finish', () => {
      const ms = Number((process.hrtime.bigint() - inicio) / 1_000_000n);
      const usuario = (requisicao as RequisicaoAutenticada).usuario?.id ?? '-';
      // Só o caminho, sem query string: filtros podem conter nome, microchip etc.
      logger.log(
        `${requisicao.method} ${requisicao.path} ${resposta.statusCode} ${ms}ms req=${requisicaoId} usuario=${usuario}`,
      );
    });

    armazenamento.run({ requisicaoId }, () => proximo());
  };
}
