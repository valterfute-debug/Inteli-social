import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ManutencaoService } from '../manutencao/manutencao.service';

/** Roda a limpeza uma vez: `npm run manutencao` (compila antes; o NestJS precisa dos metadados do tsc). */
async function executar() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    console.log(JSON.stringify(await app.get(ManutencaoService).executar(), null, 2));
  } finally {
    await app.close();
  }
}

executar().catch((erro: unknown) => {
  console.error((erro as Error).message);
  process.exitCode = 1;
});
