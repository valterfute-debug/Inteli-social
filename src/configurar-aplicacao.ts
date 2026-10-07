import { INestApplication, Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { FiltroExcecaoGlobal } from './common/filtros/filtro-excecao-global';
import { middlewareContextoRequisicao } from './requisicao/contexto-requisicao';

/**
 * Origens liberadas para o frontend. Sem CORS_ORIGINS: em desenvolvimento/teste qualquer origem;
 * em produção nenhuma (falha fechada, para não expor a API a qualquer site por esquecimento).
 */
export function resolverOrigensCors(ambiente: string, origens: string | undefined) {
  const lista = (origens ?? '')
    .split(',')
    .map((origem) => origem.trim())
    .filter(Boolean);
  if (lista.length > 0) return lista;
  return ambiente === 'production' ? false : true;
}

export function configurarAplicacao(app: INestApplication) {
  const config = app.get(ConfigService);
  const ambiente = config.get<string>('NODE_ENV') ?? 'development';

  // Atrás do proxy do Render: o IP real do cliente vem em X-Forwarded-For (usado pelo rate limit).
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Primeiro de tudo: até as respostas de erro mais precoces carregam o ID de correlação.
  app.use(middlewareContextoRequisicao());
  app.use(helmet());
  // Respostas trazem dados pessoais e links assinados de fotos: nada de cache em proxy ou navegador.
  app.use((_requisicao: Request, resposta: Response, proximo: NextFunction) => {
    resposta.setHeader('Cache-Control', 'no-store');
    proximo();
  });
  const origem = resolverOrigensCors(ambiente, config.get<string>('CORS_ORIGINS'));
  if (origem === false) {
    new Logger('CORS').warn(
      'CORS_ORIGINS não definido em produção: requisições de navegador bloqueadas',
    );
  }
  app.enableCors({
    origin: origem,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replayed', 'X-Request-Id'],
    maxAge: 600,
  });
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new FiltroExcecaoGlobal());
}
