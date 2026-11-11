import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UsuariosService } from './usuarios.service';
import { createClient } from '@supabase/supabase-js';
jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));
describe('troca inicial de senha', () => {
  const usuario = { id: 'a', email: 'a@example.test' };
  const prisma = { usuario: { findUnique: jest.fn(), updateMany: jest.fn() } };
  const config = {
    get: (key: string) =>
      ({
        SENHA_TEMPORARIA: 'temporaria-test',
        SUPABASE_URL: 'https://example.test',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-key',
      })[key],
  };
  const service = new UsuariosService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
  );
  const update = jest.fn();
  beforeEach(() => {
    jest.resetAllMocks();
    (createClient as jest.Mock).mockReturnValue({ auth: { admin: { updateUserById: update } } });
  });
  it('recusa reutilizar a senha temporária', async () => {
    prisma.usuario.findUnique.mockResolvedValue({ ativo: true, deveTrocarSenha: true });
    await expect(service.trocarSenhaInicial(usuario, 'temporaria-test')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(update).not.toHaveBeenCalled();
  });
  it('altera senha e libera somente se a conta permanece ativa e pendente', async () => {
    prisma.usuario.findUnique.mockResolvedValue({
      ativo: true,
      deveTrocarSenha: true,
      tokensInvalidosAntes: null,
    });
    update.mockResolvedValue({ error: null });
    prisma.usuario.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.trocarSenhaInicial(usuario, 'nova-senha-segura')).resolves.toEqual({
      ok: true,
    });
    expect(prisma.usuario.updateMany).toHaveBeenCalledWith({
      where: { id: 'a', ativo: true, deveTrocarSenha: true, tokensInvalidosAntes: null },
      data: { deveTrocarSenha: false },
    });
  });
});
