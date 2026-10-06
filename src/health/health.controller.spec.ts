import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('Controller de saúde', () => {
  it('informa disponibilidade da aplicação sem consultar o banco', () => {
    const prisma = { $queryRaw: jest.fn() } as unknown as PrismaService;
    expect(new HealthController(prisma).check().status).toBe('ok');
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('readiness confirma a conexão com o banco', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as PrismaService;
    await expect(new HealthController(prisma).ready()).resolves.toMatchObject({ banco: 'ok' });
  });

  it('readiness responde 503 quando o banco está indisponível', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    } as unknown as PrismaService;
    await expect(new HealthController(prisma).ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
