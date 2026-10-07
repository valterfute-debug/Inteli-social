import { BadRequestException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  DIAS_RETENCAO_CHAVES,
  IdempotenciaService,
  hashConteudo,
  lerChaveIdempotencia,
} from './idempotencia.service';

const CHAVE = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';

describe('hashConteudo', () => {
  it('não depende da ordem dos campos nem de campos indefinidos', () => {
    expect(hashConteudo('POST /animals', { a: 1, b: { c: 2, d: 3 }, e: undefined })).toBe(
      hashConteudo('POST /animals', { b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('muda quando muda o conteúdo ou a operação', () => {
    const base = hashConteudo('POST /animals', { nome: 'Luna' });
    expect(hashConteudo('POST /animals', { nome: 'Lua' })).not.toBe(base);
    expect(hashConteudo('POST /fotos', { nome: 'Luna' })).not.toBe(base);
  });
});

describe('lerChaveIdempotencia', () => {
  it('aceita UUID v4 e normaliza para minúsculas', () => {
    expect(lerChaveIdempotencia(CHAVE.toUpperCase(), true)).toBe(CHAVE);
  });

  it.each([undefined, '', 'abc', '00000000-0000-0000-0000-000000000000'])(
    'recusa %p quando obrigatória',
    (valor) => {
      expect(() => lerChaveIdempotencia(valor, true)).toThrow(BadRequestException);
    },
  );

  it('ausente e opcional: undefined; presente e inválida: 400 mesmo opcional', () => {
    expect(lerChaveIdempotencia(undefined, false)).toBeUndefined();
    expect(() => lerChaveIdempotencia('abc', false)).toThrow(BadRequestException);
  });
});

describe('IdempotenciaService', () => {
  const ctx = {
    usuarioId: 'u1',
    chave: CHAVE,
    operacao: 'POST /animals',
    conteudo: { nome: 'Luna' },
  };

  function servicoCom(registro: unknown) {
    const prisma = {
      chaveIdempotencia: {
        findUnique: jest.fn().mockResolvedValue(registro),
        deleteMany: jest.fn().mockResolvedValue({ count: 4 }),
      },
    } as unknown as PrismaService;
    return { servico: new IdempotenciaService(prisma), prisma };
  }

  it('chave nova: não é reenvio', async () => {
    await expect(servicoCom(null).servico.verificarReenvio(ctx)).resolves.toBeNull();
  });

  it('mesma chave e mesmo conteúdo: devolve o recurso da primeira vez', async () => {
    const { servico } = servicoCom({
      operacao: ctx.operacao,
      hashConteudo: hashConteudo(ctx.operacao, ctx.conteudo),
      recursoId: 'animal-1',
    });
    await expect(servico.verificarReenvio(ctx)).resolves.toBe('animal-1');
  });

  it('mesma chave com conteúdo diferente: 409', async () => {
    const { servico } = servicoCom({
      operacao: ctx.operacao,
      hashConteudo: hashConteudo(ctx.operacao, { nome: 'Outro' }),
      recursoId: 'animal-1',
    });
    await expect(servico.verificarReenvio(ctx)).rejects.toBeInstanceOf(ConflictException);
  });

  it('limpeza remove só chaves mais antigas que a retenção', async () => {
    const { servico, prisma } = servicoCom(null);
    const agora = new Date('2026-10-31T12:00:00.000Z');

    await expect(servico.limparExpiradas(agora)).resolves.toBe(4);

    const limite = (prisma.chaveIdempotencia.deleteMany as jest.Mock).mock.calls[0][0].where
      .createdAt.lt as Date;
    expect(agora.getTime() - limite.getTime()).toBe(DIAS_RETENCAO_CHAVES * 24 * 60 * 60 * 1000);
  });
});
