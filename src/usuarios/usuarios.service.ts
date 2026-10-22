import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/tipos';

@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async obterPerfil(usuario: UsuarioAutenticado) {
    const registro = await this.prisma.usuario.findUnique({ where: { id: usuario.id } });
    if (!registro) throw new NotFoundException('Usuário não encontrado');

    return { id: registro.id, email: registro.email, nome: registro.nome };
  }
}
