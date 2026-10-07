import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import Joi from 'joi';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AnimalsModule } from './animals/animals.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { HealthEventsModule } from './health-events/health-events.module';
import { ProntuarioModule } from './prontuario/prontuario.module';
import { StorageModule } from './storage/storage.module';
import { FotosModule } from './fotos/fotos.module';
import { AuthModule } from './auth/auth.module';
@Module({
  imports: [
    PrismaModule,
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validationSchema: Joi.object({
        NODE_ENV: Joi.string()
          .valid('development', 'test', 'staging', 'production')
          .default('development'),
        PORT: Joi.number().port().default(3000),
        DATABASE_URL: Joi.string()
          .uri({ scheme: ['postgresql', 'postgres'] })
          .required(),
        DIRECT_URL: Joi.string()
          .uri({ scheme: ['postgresql', 'postgres'] })
          .required(),
        // Sem Storage não há foto nem admissão, e sem a URL não há como validar o login.
        SUPABASE_URL: Joi.string()
          .uri()
          .when('NODE_ENV', { is: 'production', then: Joi.required(), otherwise: Joi.optional() }),
        SUPABASE_SERVICE_ROLE_KEY: Joi.string().when('NODE_ENV', {
          is: 'production',
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
        SUPABASE_STORAGE_BUCKET: Joi.string().optional(),
        CORS_ORIGINS: Joi.string().optional(),
        SWAGGER_ENABLED: Joi.boolean().default(false),
        LIMITE_REQUISICOES_POR_MINUTO: Joi.number().integer().min(1).default(120),
      }),
    }),
    // Limite por IP contra abuso e varredura; folgado para até ~50 usuários simultâneos.
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: Number(process.env.LIMITE_REQUISICOES_POR_MINUTO ?? 120) },
    ]),
    AuthModule,
    HealthModule,
    AnimalsModule,
    CatalogosModule,
    HealthEventsModule,
    ProntuarioModule,
    StorageModule,
    FotosModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
