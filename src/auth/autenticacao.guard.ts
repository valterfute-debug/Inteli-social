import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { ROTA_PUBLICA } from './decoradores';
import { RequisicaoAutenticada, UsuarioAutenticado } from './tipos';
import { VerificadorTokenService } from './verificador-token.service';

export function extrairToken(cabecalho: string | undefined): string | null {
  if (!cabecalho) return null;
  const [esquema, token, ...resto] = cabecalho.trim().split(/\s+/);
  if (esquema?.toLowerCase() !== 'bearer' || !token || resto.length > 0) return null;
  return token;
}

/**
 * Guard global: toda rota exige token do Supabase Auth (salvo @Publica()) e uma conta
 * ativa na tabela Usuario. Todas as contas ativas têm as mesmas permissões de negócio.
 */
@Injectable()
export class AutenticacaoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verificador: VerificadorTokenService,
    private readonly prisma: PrismaService,
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

    const usuario = await this.verificador.verificar(token);
    await this.garantirContaAtiva(usuario);
    requisicao.usuario = usuario;
    return true;
  }

  private async garantirContaAtiva(usuario: UsuarioAutenticado) {
    const registro = await this.prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { ativo: true },
    });
    // Login válido no Supabase, mas sem liberação na API (ou desativado): 403, não 401.
    if (!registro || !registro.ativo) {
      throw new ForbiddenException('Conta sem acesso liberado. Peça liberação à coordenação.');
    }
  }
}
