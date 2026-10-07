import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';
import { SituacaoBucket, SupabaseStorageService } from '../storage/supabase-storage.service';

function bancoOk() {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  } as unknown as PrismaService;
}

function storageCom(situacao: SituacaoBucket | Error) {
  return {
    situacaoBucket:
      situacao instanceof Error
        ? jest.fn().mockRejectedValue(situacao)
        : jest.fn().mockResolvedValue(situacao),
  } as unknown as SupabaseStorageService;
}

describe('Controller de saúde', () => {
  it('informa disponibilidade da aplicação sem consultar banco nem storage', () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    const storage = storageCom('privado');
    expect(new HealthController(prisma, storage).check().status).toBe('ok');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(storage.situacaoBucket).not.toHaveBeenCalled();
  });

  it('readiness confirma o banco e o bucket privado', async () => {
    await expect(
      new HealthController(bancoOk(), storageCom('privado')).ready(),
    ).resolves.toMatchObject({ banco: 'ok', armazenamento: 'privado' });
  });

  it('readiness responde 503 quando o banco está indisponível', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as PrismaService;
    await expect(
      new HealthController(prisma, storageCom('privado')).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('readiness responde 503 quando o bucket de fotos ficou público', async () => {
    await expect(
      new HealthController(bancoOk(), storageCom('publico')).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('readiness responde 503 quando não consegue consultar o storage', async () => {
    await expect(
      new HealthController(bancoOk(), storageCom(new Error('fora do ar'))).ready(),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('sem storage configurado (desenvolvimento) o readiness não falha', async () => {
    await expect(
      new HealthController(bancoOk(), storageCom('nao_configurado')).ready(),
    ).resolves.toMatchObject({ armazenamento: 'nao_configurado' });
  });
});
