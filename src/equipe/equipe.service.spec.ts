import { ConflictException, ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EquipeService } from './equipe.service';
import { createClient } from '@supabase/supabase-js';
import { Prisma } from '@prisma/client';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
const actor = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'equipe@example.test' };
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
function fixture() {
  const tx = {
    usuario: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn(),
    },
    eventoAuditoria: { create: jest.fn() },
    conviteEquipe: { create: jest.fn().mockResolvedValue({ id: 'convite-1' }), update: jest.fn() },
  };
  const prisma = {
    usuario: { findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
  const config = {
    get: jest.fn(
      (key: string) =>
        ({
          SUPABASE_URL: 'https://example.test',
          SUPABASE_SERVICE_ROLE_KEY: 'synthetic-test-key',
          CONVITE_REDIRECT_URL: 'https://example.test/ativar-acesso',
        })[key],
    ),
  };
  const send = jest.fn();
  (createClient as jest.Mock).mockReturnValue({ auth: { admin: { inviteUserByEmail: send } } });
  return {
    tx,
    prisma,
    config,
    send,
    service: new EquipeService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
    ),
  };
}
describe('Gestão de equipe', () => {
  it('não permite desativar o próprio acesso', async () => {
    const f = fixture();
    await expect(f.service.alterar(actor, actor.id, false)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.prisma.$transaction).not.toHaveBeenCalled();
  });
  it('impede administrador comum de promover uma conta', async () => {
    const f = fixture();
    f.tx.usuario.findUnique.mockResolvedValueOnce({ ativo: true, administradorMaster: false });
    await expect(f.service.alterarAdministracao(actor, other, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(f.tx.usuario.updateMany).not.toHaveBeenCalled();
  });
  it('permite master conceder e audita a permissão', async () => {
    const f = fixture();
    f.tx.usuario.findUnique
      .mockResolvedValueOnce({ ativo: true, administradorMaster: true })
      .mockResolvedValueOnce({
        id: other,
        ativo: true,
        administradorMaster: false,
        gerenciaEquipe: false,
      });
    await expect(f.service.alterarAdministracao(actor, other, true)).resolves.toEqual({
      id: other,
      gerenciaEquipe: true,
    });
    expect(f.tx.eventoAuditoria.create).toHaveBeenCalledWith({
      data: {
        usuarioId: actor.id,
        acao: 'ADMINISTRACAO_CONCEDIDA',
        entidade: 'Usuario',
        entidadeId: other,
      },
    });
  });
  it('impede administrador comum de desativar outro administrador', async () => {
    const f = fixture();
    f.tx.usuario.findUnique
      .mockResolvedValueOnce({ id: other, ativo: true, gerenciaEquipe: true })
      .mockResolvedValueOnce({ ativo: true, administradorMaster: false });
    await expect(f.service.alterar(actor, other, false)).rejects.toBeInstanceOf(ForbiddenException);
    expect(f.tx.usuario.updateMany).not.toHaveBeenCalled();
  });
  it('desativa outra conta e registra auditoria na mesma transação', async () => {
    const f = fixture();
    f.tx.usuario.findUnique.mockResolvedValue({ id: other, ativo: true });
    f.tx.usuario.update.mockResolvedValue({ id: other, ativo: false });
    await expect(f.service.alterar(actor, other, false)).resolves.toEqual({
      id: other,
      ativo: false,
    });
    expect(f.tx.eventoAuditoria.create).toHaveBeenCalledWith({
      data: {
        usuarioId: actor.id,
        acao: 'ACESSO_DESATIVADO',
        entidade: 'Usuario',
        entidadeId: other,
      },
    });
  });
  it('não convida e-mail já cadastrado, inclusive com caixa diferente', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue({ id: other });
    await expect(f.service.convidar(actor, 'Maria', 'Maria@Example.test')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it('não afirma envio quando o provedor falha', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.send.mockResolvedValue({ data: { user: null }, error: { message: 'failed' } });
    await expect(f.service.convidar(actor, 'Maria', 'maria@example.test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.tx.usuario.create).not.toHaveBeenCalled();
  });
  it('libera o usuário convidado e audita sem salvar a chave', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.send.mockResolvedValue({ data: { user: { id: other } }, error: null });
    await expect(f.service.convidar(actor, ' Maria ', 'Maria@Example.test')).resolves.toMatchObject(
      { id: other, ativo: true },
    );
    expect(f.tx.usuario.create).toHaveBeenCalledWith({
      data: { id: other, nome: 'Maria', email: 'maria@example.test', ativo: true },
    });
    expect(f.tx.eventoAuditoria.create).toHaveBeenCalled();
    expect(f.tx.conviteEquipe.create.mock.invocationCallOrder[0]).toBeLessThan(
      f.send.mock.invocationCallOrder[0],
    );
    expect(f.tx.conviteEquipe.update).toHaveBeenCalledWith({
      where: { id: 'convite-1' },
      data: { status: 'CONCLUIDO' },
    });
  });
  it('informa quando o convite saiu e a liberação falhou', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.send.mockResolvedValue({ data: { user: { id: other } }, error: null });
    f.tx.usuario.create.mockRejectedValue(new Error('db'));
    await expect(f.service.convidar(actor, 'Maria', 'maria@example.test')).rejects.toThrow(
      'O convite foi enviado, mas o acesso não foi liberado',
    );
  });
  it('reserva a intenção antes do provedor e impede novo envio em caso de duplicação', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.tx.conviteEquipe.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );
    await expect(f.service.convidar(actor, 'Maria', 'Maria@Example.test')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(f.send).not.toHaveBeenCalled();
  });
  it('preserva a solicitação ao receber erro ou resposta incerta do provedor', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.send.mockRejectedValue(new Error('timeout'));
    await expect(f.service.convidar(actor, 'Maria', 'maria@example.test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.tx.conviteEquipe.create).toHaveBeenCalledTimes(1);
    expect(f.tx.conviteEquipe.update).not.toHaveBeenCalled();
    expect(f.tx.eventoAuditoria.create).toHaveBeenCalledWith({
      data: {
        usuarioId: actor.id,
        acao: 'CONVITE_SOLICITADO',
        entidade: 'ConviteEquipe',
        entidadeId: 'convite-1',
      },
    });
  });
  it('não contata o provedor quando a reserva falha', async () => {
    const f = fixture();
    f.prisma.usuario.findFirst.mockResolvedValue(null);
    f.tx.conviteEquipe.create.mockRejectedValue(new Error('db'));
    await expect(f.service.convidar(actor, 'Maria', 'maria@example.test')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.send).not.toHaveBeenCalled();
  });
});
