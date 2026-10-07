import { AuditoriaService } from '../src/auditoria/auditoria.service';

/** Auditoria simulada: só registra as chamadas. A gravação real é testada em test/e2e. */
export function auditoriaFalsa() {
  return { registrar: jest.fn().mockResolvedValue(undefined) } as unknown as AuditoriaService;
}

/** Faz o Prisma simulado aceitar `$transaction(cb)`, executando o callback com ele mesmo. */
export function comTransacao<T extends object>(prisma: T): T {
  Object.assign(prisma, {
    $transaction: jest.fn((callback: (tx: T) => unknown) => callback(prisma)),
  });
  return prisma;
}
