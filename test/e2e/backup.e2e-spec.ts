import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  ambientePostgres,
  contarTabelas,
  dadosArquivo,
  executarPg,
  integridadeAuth,
  ManifestoBackup,
  sha256,
} from '../../src/database/backup-core';

/** Own native loopback PostgreSQL, never the shared E2E Docker database or Supabase. */
describe('Backup/restauração PostgreSQL real com Auth e foto sintéticos', () => {
  const bindir = process.env.BACKUP_TEST_PG_BINDIR ?? '/usr/lib/postgresql/16/bin';
  let temporary: string;
  let source: PrismaClient;
  let restored: PrismaClient;
  let port: number;
  let started = false;
  const exec = (
    tool: string,
    args: string[],
    env: NodeJS.ProcessEnv = { PATH: process.env.PATH },
  ) => execFileSync(tool, args, { env, stdio: 'pipe', timeout: 20000, maxBuffer: 1024 * 1024 });
  const connection = (database: string) =>
    `postgresql://postgres:synthetic-only@127.0.0.1:${port}/${database}`;
  async function availablePort(): Promise<number> {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta local indisponível');
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    return address.port;
  }
  beforeAll(async () => {
    temporary = mkdtempSync(join(tmpdir(), 'ampara-backup-e2e-'));
    port = await availablePort();
    exec(join(bindir, 'initdb'), [
      '-D',
      join(temporary, 'pg'),
      '--auth=trust',
      '--username=postgres',
      '--no-instructions',
    ]);
    exec(join(bindir, 'pg_ctl'), [
      '-D',
      join(temporary, 'pg'),
      '-l',
      join(temporary, 'postgres.log'),
      '-o',
      `-h 127.0.0.1 -p ${port}`,
      '-w',
      'start',
    ]);
    started = true;
  });
  afterAll(async () => {
    await source?.$disconnect();
    await restored?.$disconnect();
    if (started) exec(join(bindir, 'pg_ctl'), ['-D', join(temporary, 'pg'), '-w', 'stop']);
    if (
      temporary &&
      dirname(resolve(temporary)) === resolve(tmpdir()) &&
      resolve(temporary).startsWith(join(resolve(tmpdir()), 'ampara-backup-e2e-'))
    )
      rmSync(temporary, { recursive: true, force: true });
  });
  it('restaura UUID/hash Auth, vínculo ficha/foto/FKs e recusa banco ocupado ou foto corrompida', async () => {
    const originName = `ampara_source_${randomBytes(8).toString('hex')}`;
    const targetName = `ampara_restore_${randomBytes(8).toString('hex')}`;
    for (const name of [originName, targetName])
      exec(join(bindir, 'createdb'), [name], ambientePostgres(connection('postgres')));
    source = new PrismaClient({ datasources: { db: { url: connection(originName) } }, log: [] });
    const statements = [
      'CREATE SCHEMA auth',
      'CREATE TABLE auth.users(id uuid PRIMARY KEY, encrypted_password text NOT NULL, email text)',
      'CREATE TABLE auth.identities(id uuid PRIMARY KEY, user_id uuid REFERENCES auth.users(id))',
      'CREATE TABLE public."Usuario"(id text PRIMARY KEY)',
      'CREATE TABLE public."Foto"(id text PRIMARY KEY,"caminhoArmazenamento" text NOT NULL,situacao text NOT NULL)',
      'CREATE TABLE public."Animal"(id text PRIMARY KEY,"fotoEntradaId" text UNIQUE REFERENCES public."Foto"(id))',
      `INSERT INTO auth.users VALUES('11111111-1111-4111-8111-111111111111','hash-sintetico-nao-valido-para-login','teste@example.invalid')`,
      `INSERT INTO auth.identities VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111')`,
      `INSERT INTO public."Usuario" VALUES('11111111-1111-4111-8111-111111111111')`,
      `INSERT INTO public."Foto" VALUES('foto-sintetica','entrada/foto.jpg','CONFIRMADA')`,
      `INSERT INTO public."Animal" VALUES('animal-sintetico','foto-sintetica')`,
    ];
    for (const sql of statements) await source.$executeRawUnsafe(sql);
    const folder = join(temporary, 'snapshot');
    mkdirSync(join(folder, 'storage'), { recursive: true });
    const captured = await source.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
        const [{ snapshot }] = await tx.$queryRaw<
          Array<{ snapshot: string }>
        >`SELECT pg_export_snapshot() AS snapshot`;
        const tabelas = await contarTabelas(tx);
        const auth = await integridadeAuth(tx);
        executarPg(
          join(bindir, 'pg_dump'),
          [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--schema=public',
            '--schema=auth',
            `--snapshot=${snapshot}`,
            `--file=${join(folder, 'banco.dump')}`,
          ],
          connection(originName),
        );
        return { tabelas, auth };
      },
      { isolationLevel: 'RepeatableRead', timeout: 25000 },
    );
    const objectFile = `storage/${sha256('entrada/foto.jpg')}.bin`;
    writeFileSync(join(folder, objectFile), 'jpg');
    const manifest: ManifestoBackup = {
      versao: 2,
      criadoEm: new Date().toISOString(),
      origem: sha256('synthetic-only'),
      backendSha: 'local-fixture',
      banco: {
        arquivo: 'banco.dump',
        ...dadosArquivo(join(folder, 'banco.dump')),
        esquemas: ['public', 'auth'],
      },
      tabelas: captured.tabelas,
      authUsuariosSha256: captured.auth.sha256,
      usuariosSemAuth: captured.auth.semAuth,
      roles: [],
      rolesPoliticas: [],
      extensoes: [],
      bucket: {
        id: 'fotos-animais',
        public: false,
        file_size_limit: null,
        allowed_mime_types: null,
      },
      objetos: [
        {
          id: 'foto-sintetica',
          caminho: 'entrada/foto.jpg',
          arquivo: objectFile,
          atualizadoEm: new Date().toISOString(),
          tamanhoBytes: 3,
          tipoMidia: 'image/jpeg',
          sha256: sha256('jpg'),
        },
      ],
      totais: {
        arquivos: 1,
        bytes: 3 + dadosArquivo(join(folder, 'banco.dump')).tamanhoBytes,
        baixados: 1,
        reutilizados: 0,
      },
    };
    writeFileSync(join(folder, 'manifesto.json'), JSON.stringify(manifest));
    const argv = [
      resolve('node_modules/tsx/dist/cli.mjs'),
      resolve('src/database/verificar-restauracao.ts'),
      '--backup',
      folder,
    ];
    const restoreEnv = {
      PATH: process.env.PATH,
      RESTORE_DATABASE_URL: connection(targetName),
      PG_RESTORE: join(bindir, 'pg_restore'),
    };
    const result = JSON.parse(exec(process.execPath, argv, restoreEnv).toString('utf8').trim());
    expect(result.restorePostgres).toBe('verificado');
    expect(result.loginSupabase).toBe('NAO_TESTADO');
    restored = new PrismaClient({ datasources: { db: { url: connection(targetName) } }, log: [] });
    expect((await integridadeAuth(restored)).sha256).toBe(captured.auth.sha256);
    const links = await restored.$queryRaw<
      Array<{ quantidade: bigint }>
    >`SELECT count(*) AS quantidade FROM public."Animal" a JOIN public."Foto" f ON f.id=a."fotoEntradaId"`;
    expect(links[0].quantidade).toBe(1n);
    expect(() => exec(process.execPath, argv, restoreEnv)).toThrow(); // Existing target must not be cleaned.
    expect(await contarTabelas(restored)).toEqual(captured.tabelas);
    writeFileSync(join(folder, objectFile), 'bad');
    const newTarget = `ampara_restore_${randomBytes(8).toString('hex')}`;
    exec(join(bindir, 'createdb'), [newTarget], ambientePostgres(connection('postgres')));
    expect(() =>
      exec(process.execPath, argv, { ...restoreEnv, RESTORE_DATABASE_URL: connection(newTarget) }),
    ).toThrow();
    expect(readFileSync(join(folder, objectFile)).toString()).toBe('bad');
  });
});
