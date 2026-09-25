import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import Joi from 'joi';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AnimalsModule } from './animals/animals.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { HealthEventsModule } from './health-events/health-events.module';
import { ProntuarioModule } from './prontuario/prontuario.module';
import { StorageModule } from './storage/storage.module';
import { FotosModule } from './fotos/fotos.module';
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
        SUPABASE_URL: Joi.string().uri().optional(),
        SUPABASE_SERVICE_ROLE_KEY: Joi.string().optional(),
        SUPABASE_STORAGE_BUCKET: Joi.string().optional(),
      }),
    }),
    HealthModule,
    AnimalsModule,
    CatalogosModule,
    HealthEventsModule,
    ProntuarioModule,
    StorageModule,
    FotosModule,
  ],
})
export class AppModule {}
