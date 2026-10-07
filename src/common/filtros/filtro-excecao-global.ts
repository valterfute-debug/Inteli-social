import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { requisicaoAtualId } from '../../requisicao/contexto-requisicao';

@Catch()
export class FiltroExcecaoGlobal implements ExceptionFilter {
  private readonly logger = new Logger(FiltroExcecaoGlobal.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const http = exception instanceof HttpException;
    const status = http ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const mensagens: Record<number, string> = {
      400: 'Requisição inválida',
      401: 'Autenticação necessária',
      403: 'Acesso negado',
      404: 'Recurso não encontrado',
      409: 'Conflito de dados',
    };
    const detalhe = http ? exception.getResponse() : null;
    const original =
      typeof detalhe === 'object' && detalhe && 'message' in detalhe
        ? (detalhe as { message: unknown }).message
        : detalhe;
    const mensagem =
      status >= 500
        ? 'Erro interno do servidor'
        : status === 404
          ? mensagens[404]
          : (original ?? mensagens[status] ?? 'Falha na requisição');
    // Detalhes estruturados opcionais de erros 4xx (ex.: animal existente com o mesmo microchip).
    const detalhes =
      status < 500 && typeof detalhe === 'object' && detalhe && 'detalhes' in detalhe
        ? (detalhe as { detalhes: unknown }).detalhes
        : undefined;
    // O mesmo ID vai na resposta e no log: quem relata o erro informa o código e achamos o log.
    const requisicaoId = requisicaoAtualId();
    if (status >= 500) {
      // O cliente recebe mensagem genérica; o detalhe fica só no log do servidor.
      this.logger.error(
        `${request.method} ${request.path} → ${status} req=${requisicaoId ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }
    response.status(status).json({
      statusCode: status,
      mensagem,
      ...(detalhes !== undefined ? { detalhes } : {}),
      caminho: request.path,
      ...(requisicaoId ? { requisicaoId } : {}),
      timestamp: new Date().toISOString(),
    });
  }
}
