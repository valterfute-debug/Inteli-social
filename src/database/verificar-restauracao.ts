import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import {
  executarPg,
  filtrarTocRestore,
  identificadorSQL,
  validarDestinoRestore,
  validarManifesto,
  verificarArquivos,
  verificarBancoRestaurado,
  verificarDestinoVazio,
} from './backup-core';

/** RESTORE_DATABASE_URL must name a newly created localhost ampara_restore_<16 hex> database. Never clean an existing database. */
async function executar() {
  const { values } = parseArgs({ options: { backup: { type: 'string' } } });
  const conexao = process.env.RESTORE_DATABASE_URL;
  if (!values.backup || !conexao) throw new Error('Informe --backup e RESTORE_DATABASE_URL local');
  const nomeBanco = validarDestinoRestore(conexao);
  const manifesto = validarManifesto(
    JSON.parse(readFileSync(join(values.backup, 'manifesto.json'), 'utf8')),
  );
  verificarArquivos(values.backup, manifesto);
  const prisma = new PrismaClient({ datasources: { db: { url: conexao } }, log: [] });
  try {
    await verificarDestinoVazio(prisma);
    for (const role of manifesto.rolesPoliticas) {
      if (
        typeof role !== 'string' ||
        role.length > 63 ||
        [...role].some((c) => c.charCodeAt(0) < 32)
      )
        throw new Error('Role de política inválido');
      const existentes = await prisma.$queryRaw<
        Array<{ existe: boolean }>
      >`SELECT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=${role}) AS existe`;
      if (!existentes[0].existe)
        await prisma.$executeRawUnsafe(
          `CREATE ROLE ${identificadorSQL(role)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`,
        );
    }
    for (const extensao of manifesto.extensoes.filter((e) =>
      ['pgcrypto', 'uuid-ossp', 'citext'].includes(e.nome),
    )) {
      if (!['public', 'extensions'].includes(extensao.esquema))
        throw new Error('Schema de extensão não suportado no teste local');
      await prisma.$executeRawUnsafe(
        `CREATE SCHEMA IF NOT EXISTS ${identificadorSQL(extensao.esquema)}`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE EXTENSION IF NOT EXISTS ${identificadorSQL(extensao.nome)} WITH SCHEMA ${identificadorSQL(extensao.esquema)}`,
      );
    }
    const lista = executarPg(
      process.env.PG_RESTORE ?? 'pg_restore',
      ['--list', join(values.backup, 'banco.dump')],
      conexao,
    ).toString('utf8');
    const temporaria = mkdtempSync(join(tmpdir(), 'ampara-restore-toc-'));
    const selecao = join(temporaria, 'selecao.list');
    writeFileSync(selecao, filtrarTocRestore(lista), { mode: 0o600 });
    try {
      executarPg(
        process.env.PG_RESTORE ?? 'pg_restore',
        [
          '--exit-on-error',
          '--single-transaction',
          '--no-owner',
          '--no-privileges',
          `--use-list=${selecao}`,
          `--dbname=${nomeBanco}`,
          join(values.backup, 'banco.dump'),
        ],
        conexao,
      );
    } finally {
      // Remove only the exact temporary TOC file and its now-empty directory.
      unlinkSync(selecao);
      rmdirSync(temporaria);
    }
    await verificarBancoRestaurado(prisma, manifesto);
    console.log(
      JSON.stringify({
        restorePostgres: 'verificado',
        tabelas: manifesto.tabelas.length,
        arquivos: manifesto.objetos.length,
        authUsuarios: 'hash-e-UUID-conferidos',
        loginSupabase: 'NAO_TESTADO',
        storageSupabase: 'ARQUIVOS_VERIFICADOS_NAO_REENVIADOS',
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
executar().catch(() => {
  console.error(
    'Restore falhou; destino deve ser novo, vazio e local. Não há comprovação de recuperação completa Supabase.',
  );
  process.exitCode = 1;
});
