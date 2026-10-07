import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWTVerifyGetKey, errors, jwtVerify } from 'jose';
import { UsuarioAutenticado } from './tipos';

export const CHAVES_JWT = Symbol('CHAVES_JWT');

/** Só algoritmos assimétricos: impede um token assinado com segredo compartilhado (ex.: anon key). */
const ALGORITMOS_ACEITOS = ['ES256', 'RS256'];

@Injectable()
export class VerificadorTokenService {
  private readonly logger = new Logger(VerificadorTokenService.name);

  constructor(
    @Inject(CHAVES_JWT) private readonly chaves: JWTVerifyGetKey | null,
    private readonly config: ConfigService,
  ) {}

  async verificar(token: string): Promise<UsuarioAutenticado> {
    const supabaseUrl = this.config.get<string>('SUPABASE_URL');
    if (!this.chaves || !supabaseUrl) {
      this.logger.error('SUPABASE_URL ausente: não é possível validar tokens');
      throw new ServiceUnavailableException('Autenticação não configurada');
    }

    try {
      const { payload } = await jwtVerify(token, this.chaves, {
        issuer: `${supabaseUrl.replace(/\/$/, '')}/auth/v1`,
        audience: 'authenticated',
        algorithms: ALGORITMOS_ACEITOS,
      });
      if (typeof payload.sub !== 'string' || payload.sub === '') {
        throw new UnauthorizedException('Token inválido ou expirado');
      }
      return {
        id: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : null,
      };
    } catch (erro) {
      if (erro instanceof UnauthorizedException) throw erro;
      // Falha ao buscar as chaves públicas não é culpa do cliente: 503, e o detalhe vai pro log.
      if (erro instanceof errors.JWKSTimeout || !(erro instanceof errors.JOSEError)) {
        this.logger.error(`Falha ao validar token: ${(erro as Error).message}`);
        throw new ServiceUnavailableException('Autenticação temporariamente indisponível');
      }
      throw new UnauthorizedException('Token inválido ou expirado');
    }
  }
}
