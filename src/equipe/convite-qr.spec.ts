import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { PrismaService } from '../prisma/prisma.service';
import { EquipeService } from './equipe.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
describe('convite QR', () => {
  const token = 'a'.repeat(43);
  const createUser = jest.fn();
  const tx = {
    conviteQr: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    usuario: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
    eventoAuditoria: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn(async (fn) => fn(tx)) };
  const config = {
    get: (key: string) =>
      ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key' })[key],
  };
  const service = new EquipeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue({ auth: { admin: { createUser } } });
    tx.conviteQr.findUnique.mockResolvedValue({
      id: 'qr',
      criadoPorId: 'admin',
      estado: 'DISPONIVEL',
      expiraEm: new Date(Date.now() + 60_000),
    });
    tx.usuario.findUnique.mockResolvedValue({ ativo: true, gerenciaEquipe: true });
    tx.usuario.findFirst.mockResolvedValue(null);
    tx.conviteQr.updateMany.mockResolvedValue({ count: 1 });
    createUser.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });
  });
  it('gera chave aleatória e guarda somente o hash', async () => {
    tx.conviteQr.create.mockResolvedValue({ id: 'qr' });
    const result = await service.criarConviteQr({ id: 'admin', email: 'admin@example.test' });
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const data = tx.conviteQr.create.mock.calls[0][0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(data.tokenHash).not.toContain(result.token);
    expect(Date.parse(result.expiraEm) - Date.now()).toBeGreaterThan(14 * 60_000);
  });
  it('reserva o convite antes de criar a conta e registra o consumo', async () => {
    await expect(
      service.aceitarConviteQr(token, 'PESSOA@example.test', 'senha-segura'),
    ).resolves.toEqual({ ok: true });
    expect(tx.conviteQr.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      createUser.mock.invocationCallOrder[0],
    );
    expect(tx.usuario.create).toHaveBeenCalledWith({
      data: { id: 'new-user', email: 'pessoa@example.test', ativo: true },
    });
    expect(tx.conviteQr.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ estado: 'CONCLUIDO' }) }),
    );
  });
  it.each(['CONCLUIDO', 'PROCESSANDO'])('recusa convite %s', async (estado) => {
    tx.conviteQr.findUnique.mockResolvedValue({ estado, expiraEm: new Date(Date.now() + 60_000) });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('inválido ou expirado');
    expect(createUser).not.toHaveBeenCalled();
  });
  it('recusa convite expirado e reserva concorrente perdida', async () => {
    tx.conviteQr.findUnique.mockResolvedValueOnce({ estado: 'DISPONIVEL', expiraEm: new Date(0) });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('expirado');
    tx.conviteQr.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('já utilizado');
    expect(createUser).not.toHaveBeenCalled();
  });
  it('não libera novo uso quando o provedor falha', async () => {
    createUser.mockResolvedValue({ data: { user: null }, error: { message: 'falha' } });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('Procure suporte');
    expect(tx.conviteQr.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.conviteQr.update).not.toHaveBeenCalled();
  });
  it('não aceita convite de administrador desativado nem e-mail já cadastrado', async () => {
    tx.usuario.findUnique.mockResolvedValueOnce({ ativo: false, gerenciaEquipe: true });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('inválido ou expirado');
    tx.usuario.findFirst.mockResolvedValueOnce({ id: 'existing-user' });
    await expect(
      service.aceitarConviteQr(token, 'pessoa@example.test', 'senha-segura'),
    ).rejects.toThrow('Não foi possível criar a conta');
    expect(createUser).not.toHaveBeenCalled();
  });
});
