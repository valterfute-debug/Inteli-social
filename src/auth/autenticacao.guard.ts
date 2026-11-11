import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { PERMITE_SENHA_TEMPORARIA, ROTA_PUBLICA } from './decoradores';
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
 * ativa na tabela Usuario. A gestão de equipe tem autorização específica no servidor.
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
    const permiteTemporaria = this.reflector.getAllAndOverride<boolean>(PERMITE_SENHA_TEMPORARIA, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    await this.garantirContaAtiva(usuario, permiteTemporaria === true);
    requisicao.usuario = usuario;
    return true;
  }

  private async garantirContaAtiva(usuario: UsuarioAutenticado, permiteTemporaria: boolean) {
    const registro = await this.prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { ativo: true, deveTrocarSenha: true, tokensInvalidosAntes: true },
    });
    // Login válido no Supabase, mas sem liberação na API (ou desativado): 403, não 401.
    if (!registro || !registro.ativo) {
      throw new ForbiddenException('Conta sem acesso liberado. Peça liberação à coordenação.');
    }
    if (
      registro.tokensInvalidosAntes &&
      (!usuario.emitidoEm || usuario.emitidoEm * 1000 < registro.tokensInvalidosAntes.getTime())
    ) {
      throw new UnauthorizedException('Sessão encerrada. Entre novamente.');
    }
    if (registro.deveTrocarSenha && !permiteTemporaria) {
      throw new ForbiddenException('Troque sua senha temporária para continuar.');
    }
  }
}
