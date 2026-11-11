import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { RequisicaoAutenticada } from '../auth/tipos';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class GerenciaEquipeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const usuario = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().usuario;
    if (!usuario) throw new ForbiddenException('Acesso não autorizado.');
    const registro = await this.prisma.usuario.findUnique({
      where: { id: usuario.id },
      select: { ativo: true, gerenciaEquipe: true },
    });
    if (!registro?.ativo || !registro.gerenciaEquipe)
      throw new ForbiddenException('Somente administradores podem gerenciar a equipe.');
    return true;
  }
}
