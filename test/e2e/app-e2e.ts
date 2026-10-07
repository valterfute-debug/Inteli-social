import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PapelUsuario, PrismaClient } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { CHAVES_JWT } from '../../src/auth/verificador-token.service';
import { configurarAplicacao } from '../../src/configurar-aplicacao';
import { liberarUsuario } from '../../src/database/liberar-usuario';
import { popularCatalogos } from '../../src/database/seed';
import { SupabaseStorageService } from '../../src/storage/supabase-storage.service';
import { criarEmissorDeTokens } from '../tokens-teste';

/** Storage simulado: o e2e testa a API e o banco; o Supabase Storage tem testes próprios. */
export const storageSimulado = {
  criarUrlEnvio: async (caminho: string) => ({
    urlEnvio: `https://storage.invalid/envio/${caminho}`,
  }),
  obterMetadados: async () => ({ tamanhoBytes: 1000, tipoMidia: 'image/jpeg' }),
  removerArquivo: async () => undefined,
  situacaoBucket: async () => 'privado' as const,
  criarUrlsLeitura: async (caminhos: string[]) =>
    new Map(caminhos.map((caminho) => [caminho, `https://storage.invalid/leitura/${caminho}`])),
};

/** Apaga os dados (não o schema) para cada suíte começar do zero. */
export async function limparBanco(prisma: PrismaClient) {
  const tabelas = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tabelas.length === 0) return;
  const lista = tabelas.map((t) => `"public"."${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`);
}

export interface UsuarioTeste {
  id: string;
  autorizacao: string;
}

export async function criarAmbienteE2E() {
  const prisma = new PrismaClient();
  await limparBanco(prisma);
  await popularCatalogos(prisma);

  const emissor = await criarEmissorDeTokens();
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAVES_JWT)
    .useValue(emissor.chaves)
    .overrideProvider(SupabaseStorageService)
    .useValue(storageSimulado)
    .compile();
  const app: INestApplication = modulo.createNestApplication();
  configurarAplicacao(app);
  await app.init();

  /** Cria a conta no "Supabase" (token) e, se `papel` vier, libera na API. */
  async function usuario(
    id: string,
    papel?: PapelUsuario,
    unidades: string[] = [],
    ativo = true,
  ): Promise<UsuarioTeste> {
    if (papel)
      await liberarUsuario(prisma, { id, papel, unidades, ativo, email: `${id}@teste.invalid` });
    return { id, autorizacao: `Bearer ${await emissor.assinar({ sub: id })}` };
  }

  async function idUnidade(nome: string) {
    return (await prisma.unit.findUniqueOrThrow({ where: { name: nome } })).id;
  }

  async function encerrar() {
    await app.close();
    await prisma.$disconnect();
  }

  return { app, prisma, usuario, idUnidade, encerrar };
}
