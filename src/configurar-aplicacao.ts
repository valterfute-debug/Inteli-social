import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { FiltroExcecaoGlobal } from './common/filtros/filtro-excecao-global';

export function configurarAplicacao(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new FiltroExcecaoGlobal());
}
