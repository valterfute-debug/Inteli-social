import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configurarAplicacao } from './configurar-aplicacao';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configurarAplicacao(app);
  const swagger = new DocumentBuilder().setTitle('Ampara Animal API').setVersion('1.0').build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));
  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
