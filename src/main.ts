import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configurarAplicacao } from './configurar-aplicacao';

async function bootstrap() {
  // O limite padrão de 100 kB do corpo JSON basta: a foto vai direto ao Storage por URL assinada.
  const app = await NestFactory.create(AppModule);
  configurarAplicacao(app);

  // Swagger expõe o mapa da API; em produção só com liberação explícita.
  if (process.env.NODE_ENV !== 'production' || process.env.SWAGGER_ENABLED === 'true') {
    const swagger = new DocumentBuilder()
      .setTitle('Ampara Animal API')
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer')
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  }
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
