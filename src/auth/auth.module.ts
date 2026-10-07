import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { createRemoteJWKSet } from 'jose';
import { AutenticacaoGuard } from './autenticacao.guard';
import { CHAVES_JWT, VerificadorTokenService } from './verificador-token.service';

@Global()
@Module({
  providers: [
    {
      provide: CHAVES_JWT,
      inject: [ConfigService],
      // Chaves públicas do Supabase Auth, baixadas sob demanda e guardadas em cache pelo jose.
      useFactory: (config: ConfigService) => {
        const supabaseUrl = config.get<string>('SUPABASE_URL');
        if (!supabaseUrl) {
          new Logger('Autenticacao').warn(
            'SUPABASE_URL não definido: rotas protegidas responderão 503',
          );
          return null;
        }
        return createRemoteJWKSet(
          new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/.well-known/jwks.json`),
        );
      },
    },
    VerificadorTokenService,
    { provide: APP_GUARD, useClass: AutenticacaoGuard },
  ],
  exports: [VerificadorTokenService],
})
export class AuthModule {}
