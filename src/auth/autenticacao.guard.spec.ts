import {
  ExecutionContext,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { PapelUsuario } from '@prisma/client';
import { JWTVerifyGetKey } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import { SUPABASE_URL_TESTE, criarEmissorDeTokens } from '../../test/tokens-teste';
import { AutenticacaoGuard, extrairToken } from './autenticacao.guard';
import { Publica } from './decoradores';
import { RequisicaoAutenticada } from './tipos';
import { VerificadorTokenService } from './verificador-token.service';

class ControllerProtegido {
  rota() {}
}

@Publica()
class ControllerPublico {
  rota() {}
}

function contexto(
  requisicao: Partial<RequisicaoAutenticada>,
  classe: object = ControllerProtegido,
) {
  const instancia = classe as { prototype: { rota: () => void } };
  return {
    getHandler: () => instancia.prototype.rota,
    getClass: () => classe,
    switchToHttp: () => ({ getRequest: () => requisicao }),
  } as unknown as ExecutionContext;
}

function configCom(supabaseUrl: string | undefined) {
  return { get: () => supabaseUrl } as unknown as ConfigService;
}

const USUARIO_ADMIN = { id: 'usuario-1', ativo: true, papel: PapelUsuario.ADMIN, unidades: [] };

function prismaCom(usuario: unknown) {
  return {
    usuario: { findUnique: jest.fn().mockResolvedValue(usuario) },
  } as unknown as PrismaService;
}

function criarGuard(
  chaves: JWTVerifyGetKey | null,
  supabaseUrl: string | undefined = SUPABASE_URL_TESTE,
  prisma: PrismaService = prismaCom(USUARIO_ADMIN),
) {
  const verificador = new VerificadorTokenService(chaves, configCom(supabaseUrl));
  return new AutenticacaoGuard(new Reflector(), verificador, prisma);
}

describe('AutenticacaoGuard', () => {
  let emissor: Awaited<ReturnType<typeof criarEmissorDeTokens>>;

  beforeAll(async () => {
    emissor = await criarEmissorDeTokens();
  });

  it('libera rota marcada com @Publica() sem token', async () => {
    const guard = criarGuard(emissor.chaves);
    await expect(guard.canActivate(contexto({ headers: {} }, ControllerPublico))).resolves.toBe(
      true,
    );
  });

  it('recusa requisição anônima com 401', async () => {
    const guard = criarGuard(emissor.chaves);
    await expect(guard.canActivate(contexto({ headers: {} }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('aceita token válido e anexa o usuário à requisição', async () => {
    const guard = criarGuard(emissor.chaves);
    const token = await emissor.assinar({ sub: 'usuario-1', email: 'ana@teste.invalid' });
    const requisicao: Partial<RequisicaoAutenticada> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await expect(guard.canActivate(contexto(requisicao))).resolves.toBe(true);
    expect(requisicao.usuario).toEqual({ id: 'usuario-1', email: 'ana@teste.invalid' });
    expect(requisicao.escopo).toMatchObject({ usuarioId: 'usuario-1', todasUnidades: true });
  });

  it('carrega o escopo do operador a partir dos vínculos no banco', async () => {
    const prisma = prismaCom({
      id: 'usuario-2',
      ativo: true,
      papel: PapelUsuario.OPERADOR,
      unidades: [{ unitId: 'unidade-a' }, { unitId: 'unidade-b' }],
    });
    const guard = criarGuard(emissor.chaves, SUPABASE_URL_TESTE, prisma);
    const token = await emissor.assinar({ sub: 'usuario-2' });
    const requisicao: Partial<RequisicaoAutenticada> = {
      headers: { authorization: `Bearer ${token}` },
    };

    await guard.canActivate(contexto(requisicao));

    expect(requisicao.escopo).toEqual({
      usuarioId: 'usuario-2',
      papel: PapelUsuario.OPERADOR,
      todasUnidades: false,
      unidadeIds: ['unidade-a', 'unidade-b'],
    });
  });

  it.each([
    ['sem cadastro na API', null],
    ['desativado', { ...USUARIO_ADMIN, ativo: false }],
  ])('recusa com 403 login válido de usuário %s', async (_caso, usuario) => {
    const guard = criarGuard(emissor.chaves, SUPABASE_URL_TESTE, prismaCom(usuario));
    const token = await emissor.assinar();
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['vencido', { expiraEm: Math.floor(Date.now() / 1000) - 60 }],
    ['de outro projeto Supabase', { emissor: 'https://outro.supabase.co/auth/v1' }],
    ['com audiência diferente (ex.: anon)', { audiencia: 'anon' }],
  ])('recusa token %s com 401', async (_caso, opcoes) => {
    const guard = criarGuard(emissor.chaves);
    const token = await emissor.assinar(opcoes);
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa token assinado por uma chave que não é do projeto', async () => {
    const intruso = await criarEmissorDeTokens('chave-teste');
    const guard = criarGuard(emissor.chaves);
    const token = await intruso.assinar();
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('recusa texto que não é um JWT', async () => {
    const guard = criarGuard(emissor.chaves);
    await expect(
      guard.canActivate(contexto({ headers: { authorization: 'Bearer nao-e-um-token' } })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('falha fechada com 503 quando SUPABASE_URL não está configurado', async () => {
    const guard = criarGuard(null, undefined);
    const token = await emissor.assinar();
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('responde 503 (não 401) quando não consegue buscar as chaves do Supabase', async () => {
    const chavesForaDoAr: JWTVerifyGetKey = () => {
      throw new TypeError('fetch failed');
    };
    const guard = criarGuard(chavesForaDoAr);
    const token = await emissor.assinar();
    await expect(
      guard.canActivate(contexto({ headers: { authorization: `Bearer ${token}` } })),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe('extrairToken', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['Basic abc', null],
    ['Bearer', null],
    ['Bearer a b', null],
    ['Bearer abc', 'abc'],
    ['bearer   abc', 'abc'],
  ])('%p → %p', (cabecalho, esperado) => {
    expect(extrairToken(cabecalho)).toBe(esperado);
  });
});
