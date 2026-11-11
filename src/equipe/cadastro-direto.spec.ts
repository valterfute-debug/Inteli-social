import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EquipeService } from './equipe.service';
import { createClient } from '@supabase/supabase-js';
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
describe('cadastro direto e redefinição', () => {
  const actor = { id: 'admin', email: 'admin@example.test' };
  const tx = {
    usuario: { create: jest.fn(), update: jest.fn() },
    eventoAuditoria: { create: jest.fn() },
    conviteEquipe: { create: jest.fn().mockResolvedValue({ id: 'reserva' }), update: jest.fn() },
  };
  const prisma = {
    usuario: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn(async (fn) => fn(tx)),
  };
  const config = {
    get: (key: string) =>
      ({
        SUPABASE_URL: 'https://example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic',
        SENHA_TEMPORARIA: 'temporary-test',
      })[key],
  };
  const create = jest.fn(),
    update = jest.fn();
  const service = new EquipeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue({
      auth: { admin: { createUser: create, updateUserById: update } },
    });
  });
  it('cria conta que exige troca de senha e registra auditoria', async () => {
    prisma.usuario.findFirst.mockResolvedValue(null);
    create.mockResolvedValue({ data: { user: { id: 'new-id' } }, error: null });
    await expect(service.cadastrar(actor, 'Pessoa@Example.test')).resolves.toMatchObject({
      id: 'new-id',
      deveTrocarSenha: true,
    });
    expect(tx.usuario.create).toHaveBeenCalledWith({
      data: { id: 'new-id', email: 'pessoa@example.test', ativo: true, deveTrocarSenha: true },
    });
    expect(tx.eventoAuditoria.create).toHaveBeenCalled();
  });
  it('marca troca obrigatória e corta tokens antes de redefinir no provedor', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ id: 'other', ativo: true });
    update.mockResolvedValue({ error: null });
    await expect(service.redefinirSenha(actor, 'other')).resolves.toEqual({ ok: true });
    expect(tx.usuario.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          deveTrocarSenha: true,
          tokensInvalidosAntes: expect.any(Date),
        }),
      }),
    );
    expect(tx.usuario.update.mock.invocationCallOrder[0]).toBeLessThan(
      update.mock.invocationCallOrder[0],
    );
  });
});
