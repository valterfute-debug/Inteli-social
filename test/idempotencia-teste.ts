import { Prisma } from '@prisma/client';
import { IdempotenciaService } from '../src/idempotencia/idempotencia.service';

export const CHAVE_TESTE = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

/**
 * Idempotência simulada para testes unitários: nunca acha reenvio e só executa a escrita
 * com o próprio cliente falso. O comportamento real é testado em test/e2e com banco.
 */
export function idempotenciaFalsa(cliente: unknown) {
  return {
    verificarReenvio: jest.fn().mockResolvedValue(null),
    registrar: jest.fn().mockResolvedValue(undefined),
    executar: jest.fn(
      async (
        _ctx: unknown,
        escrever: (
          tx: Prisma.TransactionClient,
        ) => Promise<{ recursoId: string; resultado: unknown }>,
      ) => ({ ...(await escrever(cliente as Prisma.TransactionClient)), reenvio: false }),
    ),
  } as unknown as IdempotenciaService;
}
