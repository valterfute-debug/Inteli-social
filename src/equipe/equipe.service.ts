import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsuarioAutenticado } from '../auth/tipos';

@Injectable()
export class EquipeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async listar() {
    const pessoas = await this.prisma.usuario.findMany({
      select: { id: true, nome: true, email: true, ativo: true },
      orderBy: [{ nome: 'asc' }, { id: 'asc' }],
      take: 201,
    });
    return { itens: pessoas.slice(0, 200), temMais: pessoas.length > 200 };
  }

  private acessoInicial() {
    const url = this.config.get<string>('SUPABASE_URL');
    const key = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const senha = this.config.get<string>('SENHA_TEMPORARIA');
    if (!url || !key || !senha)
      throw new ServiceUnavailableException('Cadastro de acesso não configurado.');
    return {
      senha,
      cliente: createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }),
    };
  }

  async cadastrar(usuario: UsuarioAutenticado, email: string) {
    const normalizado = email.trim().toLowerCase();
    const { senha, cliente } = this.acessoInicial();
    const existente = await this.prisma.usuario.findFirst({
      where: { email: { equals: normalizado, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existente) throw new ConflictException('Já existe uma conta para este e-mail.');
    let reserva: { id: string };
    try {
      reserva = await this.prisma.$transaction(async (tx) => {
        const item = await tx.conviteEquipe.create({
          data: { email: normalizado, nome: normalizado, solicitadoPor: usuario.id },
          select: { id: true },
        });
        await tx.eventoAuditoria.create({
          data: {
            usuarioId: usuario.id,
            acao: 'CONTA_SOLICITADA',
            entidade: 'ConviteEquipe',
            entidadeId: item.id,
          },
        });
        return item;
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
        throw new ConflictException('Já existe uma solicitação para este e-mail. Procure suporte.');
      throw new ServiceUnavailableException('Não foi possível preparar o cadastro.');
    }
    const { data, error } = await cliente.auth.admin.createUser({
      email: normalizado,
      password: senha,
      email_confirm: true,
    });
    if (error || !data.user?.id)
      throw new ServiceUnavailableException('Não foi possível criar a conta.');
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.create({
          data: { id: data.user.id, email: normalizado, ativo: true, deveTrocarSenha: true },
        });
        await tx.eventoAuditoria.create({
          data: {
            usuarioId: usuario.id,
            acao: 'CONTA_CRIADA',
            entidade: 'Usuario',
            entidadeId: data.user.id,
          },
        });
        await tx.conviteEquipe.update({ where: { id: reserva.id }, data: { status: 'CONCLUIDO' } });
      });
    } catch {
      throw new ServiceUnavailableException(
        'Conta criada no provedor, mas não liberada. Procure suporte.',
      );
    }
    return { id: data.user.id, email: normalizado, ativo: true, deveTrocarSenha: true };
  }

  async redefinirSenha(usuario: UsuarioAutenticado, id: string) {
    if (id === usuario.id)
      throw new ForbiddenException('Não é possível redefinir a própria senha por aqui.');
    const { senha, cliente } = this.acessoInicial();
    const pessoa = await this.prisma.usuario.findUnique({
      where: { id },
      select: { id: true, ativo: true },
    });
    if (!pessoa) throw new NotFoundException('Pessoa não encontrada.');
    if (!pessoa.ativo) throw new ForbiddenException('Reative o acesso antes de redefinir a senha.');
    const corte = new Date(Math.ceil(Date.now() / 1000) * 1000);
    await this.prisma.$transaction(async (tx) => {
      await tx.usuario.update({
        where: { id },
        data: { deveTrocarSenha: true, tokensInvalidosAntes: corte },
      });
      await tx.eventoAuditoria.create({
        data: {
          usuarioId: usuario.id,
          acao: 'SENHA_REDEFINICAO_SOLICITADA',
          entidade: 'Usuario',
          entidadeId: id,
        },
      });
    });
    const { error } = await cliente.auth.admin.updateUserById(id, { password: senha });
    if (error)
      throw new ServiceUnavailableException(
        'Não foi possível confirmar a redefinição. Procure suporte.',
      );
    return { ok: true };
  }

  async alterar(usuario: UsuarioAutenticado, id: string, ativo: boolean) {
    if (id === usuario.id && !ativo)
      throw new ForbiddenException('Não é possível desativar seu próprio acesso.');
    return this.prisma.$transaction(async (tx) => {
      const pessoa = await tx.usuario.findUnique({
        where: { id },
        select: { id: true, ativo: true },
      });
      if (!pessoa) throw new NotFoundException('Pessoa não encontrada.');
      if (pessoa.ativo === ativo) return pessoa;
      const atualizada = await tx.usuario.update({
        where: { id },
        data: { ativo },
        select: { id: true, ativo: true },
      });
      await tx.eventoAuditoria.create({
        data: {
          usuarioId: usuario.id,
          acao: ativo ? 'ACESSO_REATIVADO' : 'ACESSO_DESATIVADO',
          entidade: 'Usuario',
          entidadeId: id,
        },
      });
      return atualizada;
    });
  }

  async convidar(usuario: UsuarioAutenticado, nome: string, email: string) {
    const normalizado = email.trim().toLowerCase();
    const nomeSeguro = nome.trim();
    if (!nomeSeguro) throw new BadRequestException('Informe o nome da pessoa.');
    const existente = await this.prisma.usuario.findFirst({
      where: { email: { equals: normalizado, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existente)
      throw new ConflictException(
        'Já existe uma conta para este e-mail. Confira a lista de pessoas.',
      );
    const url = this.config.get<string>('SUPABASE_URL');
    const chave = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const retorno = this.config.get<string>('CONVITE_REDIRECT_URL');
    let retornoSeguro = false;
    try {
      const destino = new URL(retorno ?? '');
      retornoSeguro =
        destino.protocol === 'https:' &&
        destino.pathname === '/ativar-acesso' &&
        !destino.username &&
        !destino.password &&
        !destino.search &&
        !destino.hash;
    } catch {
      /* Invalid configuration fails closed. */
    }
    if (!url || !chave || !retorno || !retornoSeguro)
      throw new ServiceUnavailableException('Convites por e-mail ainda não estão configurados.');
    // Reserva antes do efeito externo: tentativas concorrentes ou com resultado
    // incerto não podem reenviar nem apagar a evidência de reconciliação.
    let convite: { id: string };
    try {
      convite = await this.prisma.$transaction(async (tx) => {
        const reserva = await tx.conviteEquipe.create({
          data: { email: normalizado, nome: nomeSeguro, solicitadoPor: usuario.id },
          select: { id: true },
        });
        await tx.eventoAuditoria.create({
          data: {
            usuarioId: usuario.id,
            acao: 'CONVITE_SOLICITADO',
            entidade: 'ConviteEquipe',
            entidadeId: reserva.id,
          },
        });
        return reserva;
      });
    } catch (erro) {
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002')
        throw new ConflictException(
          'Já existe uma solicitação para este e-mail. Confira a lista ou procure suporte antes de reenviar.',
        );
      throw new ServiceUnavailableException(
        'Não foi possível preparar o convite. Tente novamente.',
      );
    }
    const cliente = createClient(url, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    let resposta: Awaited<ReturnType<typeof cliente.auth.admin.inviteUserByEmail>>;
    try {
      resposta = await cliente.auth.admin.inviteUserByEmail(normalizado, {
        data: { name: nomeSeguro, ampara_convite_id: convite.id },
        redirectTo: retorno,
      });
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível confirmar o envio. Procure suporte antes de reenviar.',
      );
    }
    const { data, error } = resposta;
    if (error || !data.user?.id)
      throw new ServiceUnavailableException(
        'Não foi possível confirmar o envio. Procure suporte antes de reenviar.',
      );
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.usuario.create({
          data: { id: data.user.id, email: normalizado, nome: nomeSeguro, ativo: true },
        });
        await tx.eventoAuditoria.create({
          data: {
            usuarioId: usuario.id,
            acao: 'CONVITE_CRIADO',
            entidade: 'Usuario',
            entidadeId: data.user.id,
          },
        });
        await tx.conviteEquipe.update({ where: { id: convite.id }, data: { status: 'CONCLUIDO' } });
      });
    } catch {
      throw new ServiceUnavailableException(
        'O convite foi enviado, mas o acesso não foi liberado. Procure suporte antes de reenviar.',
      );
    }
    return { id: data.user.id, email: normalizado, nome: nomeSeguro, ativo: true };
  }
}
