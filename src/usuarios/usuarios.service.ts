import { Injectable, NotFoundException } from '@nestjs/common';
import { EscopoAcesso } from '../auth/escopo';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async obterPerfil(escopo: EscopoAcesso) {
    const usuario = await this.prisma.usuario.findUnique({ where: { id: escopo.usuarioId } });
    if (!usuario) throw new NotFoundException('Usuário não encontrado');

    const unidades = await this.prisma.unit.findMany({
      where: {
        deletedAt: null,
        ...(escopo.todasUnidades ? {} : { id: { in: escopo.unidadeIds } }),
      },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });

    return {
      id: usuario.id,
      email: usuario.email,
      nome: usuario.nome,
      papel: usuario.papel,
      todasUnidades: escopo.todasUnidades,
      unidades: unidades.map((unidade) => ({ id: unidade.id, nome: unidade.name })),
    };
  }
}
