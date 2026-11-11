import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/tipos';

@Injectable()
export class UsuariosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async obterPerfil(usuario: UsuarioAutenticado) {
    const registro = await this.prisma.usuario.findUnique({ where: { id: usuario.id } });
    if (!registro) throw new NotFoundException('Usuário não encontrado');

    return {
      id: registro.id,
      email: registro.email,
      nome: registro.nome,
      gerenciaEquipe: registro.gerenciaEquipe,
      deveTrocarSenha: registro.deveTrocarSenha,
    };
  }

  async trocarSenhaInicial(usuario: UsuarioAutenticado, senha: string) {
    const registro = await this.prisma.usuario.findUnique({ where: { id: usuario.id } });
    if (!registro?.ativo || !registro.deveTrocarSenha || registro.redefinicaoEmAndamento)
      throw new BadRequestException('Não há troca inicial pendente.');
    const temporaria = this.config.get<string>('SENHA_TEMPORARIA');
    if (!temporaria || senha === temporaria)
      throw new BadRequestException('Escolha uma senha diferente da temporária.');
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) throw new ServiceUnavailableException('Serviço de acesso indisponível.');
    const cliente = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const reserva = await this.prisma.usuario.updateMany({
      where: {
        id: usuario.id,
        ativo: true,
        deveTrocarSenha: true,
        redefinicaoEmAndamento: false,
        tokensInvalidosAntes: registro.tokensInvalidosAntes,
      },
      data: { redefinicaoEmAndamento: true },
    });
    if (reserva.count !== 1)
      throw new ConflictException('Outra alteração de senha está em andamento.');
    const { error } = await cliente.auth.admin.updateUserById(usuario.id, { password: senha });
    if (error)
      throw new ServiceUnavailableException(
        'Não foi possível confirmar a alteração. Procure suporte.',
      );
    const resultado = await this.prisma.usuario.updateMany({
      where: {
        id: usuario.id,
        ativo: true,
        deveTrocarSenha: true,
        redefinicaoEmAndamento: true,
        tokensInvalidosAntes: registro.tokensInvalidosAntes,
      },
      data: {
        deveTrocarSenha: false,
        redefinicaoEmAndamento: false,
        tokensInvalidosAntes: new Date((Math.floor(Date.now() / 1000) + 1) * 1000),
      },
    });
    if (resultado.count !== 1)
      throw new ConflictException('A conta foi alterada. Entre novamente.');
    return { ok: true };
  }
}
