import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROTA_PUBLICA } from './decoradores';
import { RequisicaoAutenticada } from './tipos';
import { VerificadorTokenService } from './verificador-token.service';

export function extrairToken(cabecalho: string | undefined): string | null {
  if (!cabecalho) return null;
  const [esquema, token, ...resto] = cabecalho.trim().split(/\s+/);
  if (esquema?.toLowerCase() !== 'bearer' || !token || resto.length > 0) return null;
  return token;
}

/** Guard global: toda rota exige token do Supabase Auth, salvo as marcadas com @Publica(). */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verificador: VerificadorTokenService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publica = this.reflector.getAllAndOverride<boolean>(ROTA_PUBLICA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publica) return true;

    const requisicao = contexto.switchToHttp().getRequest<RequisicaoAutenticada>();
    const token = extrairToken(requisicao.headers.authorization);
    if (!token) throw new UnauthorizedException('Autenticação necessária');

    requisicao.usuario = await this.verificador.verificar(token);
    return true;
  }
}
