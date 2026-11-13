import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { createClient } from '@supabase/supabase-js';
import { EquipeService } from '../../src/equipe/equipe.service';
import { PrismaService } from '../../src/prisma/prisma.service';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('convite QR com PostgreSQL', () => {
  const prisma = new PrismaClient();
  const actor = { id: randomUUID(), email: `admin-${randomUUID()}@example.test` };
  const createUser = jest.fn();
  const config = {
    get: (key: string) =>
      ({ SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic' })[key],
  };
  const service = new EquipeService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  beforeAll(async () => {
    await prisma.usuario.create({ data: { ...actor, ativo: true, gerenciaEquipe: true } });
    (createClient as jest.Mock).mockReturnValue({ auth: { admin: { createUser } } });
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });
  it('permite apenas uma ativação concorrente do mesmo código', async () => {
    const { token } = await service.criarConviteQr(actor);
    createUser.mockImplementation(async () => ({
      data: { user: { id: randomUUID() } },
      error: null,
    }));
    const results = await Promise.allSettled([
      service.aceitarConviteQr(token, `${randomUUID()}@example.test`, 'senha-aleatoria'),
      service.aceitarConviteQr(token, `${randomUUID()}@example.test`, 'senha-aleatoria'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
    expect(createUser).toHaveBeenCalledTimes(1);
    const registros = await prisma.conviteQr.findMany({ where: { criadoPorId: actor.id } });
    expect(registros).toHaveLength(1);
    expect(registros[0].estado).toBe('CONCLUIDO');
    expect(registros[0].tokenHash).not.toContain(token);
    await expect(
      service.aceitarConviteQr(token, 'outra@example.test', 'senha-aleatoria'),
    ).rejects.toThrow();
  });
  it('recusa um convite expirado no banco', async () => {
    const { token } = await service.criarConviteQr(actor);
    const { createHash } = await import('node:crypto');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await prisma.conviteQr.update({ where: { tokenHash }, data: { expiraEm: new Date(0) } });
    const calls = createUser.mock.calls.length;
    await expect(
      service.aceitarConviteQr(token, `${randomUUID()}@example.test`, 'senha-aleatoria'),
    ).rejects.toThrow('expirado');
    expect(createUser).toHaveBeenCalledTimes(calls);
  });
});
