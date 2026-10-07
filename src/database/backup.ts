import 'dotenv/config';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import {
  contarTabelas,
  copiarStorage,
  dadosArquivo,
  executarPg,
  identificarOrigem,
  integridadeAuth,
  listarObjetos,
  ManifestoBackup,
  serializarManifesto,
  validarManifesto,
} from './backup-core';

/** Only reads the source. Auth password hashes/tokens and the manifest are sensitive. Encrypt before offsite upload. */
async function executar() {
  const { values } = parseArgs({
    options: { destino: { type: 'string', default: 'backups' }, anterior: { type: 'string' } },
  });
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'fotos-animais';
  if (!url || !supabaseUrl || !chave) throw new Error('Configuração do backup incompleta');
  const origem = identificarOrigem(supabaseUrl, bucket);
  const pasta = resolve(values.destino);
  mkdirSync(pasta, { recursive: true, mode: 0o700 });
  if (readdirSync(pasta).length !== 0) throw new Error('Destino do backup deve estar vazio');
  const arquivoBanco = join(pasta, 'banco.dump');
  const prisma = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const snapshot = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
        await tx.$executeRawUnsafe(`SET LOCAL TIME ZONE 'UTC'`);
        const [{ snapshot }] = await tx.$queryRaw<
          Array<{ snapshot: string }>
        >`SELECT pg_export_snapshot() AS snapshot`;
        const tabelas = await contarTabelas(tx);
        const auth = await integridadeAuth(tx);
        if (auth.semAuth !== 0)
          throw new Error('Usuário da API sem identidade Auth; backup incompleto');
        const objetos = await listarObjetos(tx, bucket);
        const buckets = await tx.$queryRaw<
          ManifestoBackup['bucket'][]
        >`SELECT id,public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id=${bucket}`;
        if (buckets.length !== 1) throw new Error('Bucket de fotos não encontrado');
        const roles = await tx.$queryRaw<
          ManifestoBackup['roles']
        >`SELECT rolname::text AS nome,rolcanlogin AS login,rolsuper AS superuser,rolbypassrls AS "bypassRls" FROM pg_roles ORDER BY rolname`;
        const politicas = await tx.$queryRaw<
          Array<{ nome: string }>
        >`SELECT DISTINCT r.rolname::text AS nome FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=ANY(p.polroles) WHERE n.nspname IN ('public','auth') ORDER BY nome`;
        const extensoes = await tx.$queryRaw<
          ManifestoBackup['extensoes']
        >`SELECT e.extname::text AS nome,n.nspname::text AS esquema,e.extversion::text AS versao FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace ORDER BY e.extname`;
        const fichas = await tx.$queryRaw<
          Array<{ caminho: string | null; situacao: string | null }>
        >`SELECT f."caminhoArmazenamento" AS caminho,f.situacao::text AS situacao FROM public."Animal" a LEFT JOIN public."Foto" f ON f.id=a."fotoEntradaId" WHERE a."fotoEntradaId" IS NOT NULL`;
        const caminhos = new Set(objetos.map((o) => o.caminho));
        if (
          fichas.some((f) => !f.caminho || f.situacao !== 'CONFIRMADA' || !caminhos.has(f.caminho))
        )
          throw new Error('Ficha sem foto disponível no snapshot');
        executarPg(
          process.env.PG_DUMP ?? 'pg_dump',
          [
            '--format=custom',
            '--no-owner',
            '--no-privileges',
            '--schema=public',
            '--schema=auth',
            `--snapshot=${snapshot}`,
            `--file=${arquivoBanco}`,
          ],
          url,
        );
        return {
          tabelas,
          auth,
          objetos,
          bucket: {
            ...buckets[0],
            file_size_limit:
              buckets[0].file_size_limit === null ? null : Number(buckets[0].file_size_limit),
          },
          roles,
          rolesPoliticas: politicas.map((r) => r.nome),
          extensoes,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 240000 },
    );
    let anterior: { pasta: string; manifesto: ManifestoBackup } | undefined;
    if (values.anterior)
      anterior = {
        pasta: resolve(values.anterior),
        manifesto: validarManifesto(
          JSON.parse(readFileSync(join(values.anterior, 'manifesto.json'), 'utf8')),
        ),
      };
    const supabase = createClient(supabaseUrl, chave, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const banco = dadosArquivo(arquivoBanco);
    const storage = await copiarStorage({
      pasta,
      origem,
      objetos: snapshot.objetos,
      bytesBanco: banco.tamanhoBytes,
      anterior,
      baixar: async (caminho) => {
        const { data, error } = await supabase.storage.from(bucket).download(caminho);
        if (error || !data) throw new Error('Download Storage falhou');
        return Buffer.from(await data.arrayBuffer());
      },
    });
    const atuais = new Map((await listarObjetos(prisma, bucket)).map((o) => [o.caminho, o]));
    if (snapshot.objetos.some((o) => JSON.stringify(atuais.get(o.caminho)) !== JSON.stringify(o)))
      throw new Error('Storage mudou durante o backup; execute novamente');
    const manifesto: ManifestoBackup = {
      versao: 2,
      criadoEm: new Date().toISOString(),
      origem,
      backendSha: process.env.BACKUP_BACKEND_SHA ?? 'local-nao-publicado',
      banco: { arquivo: 'banco.dump', ...banco, esquemas: ['public', 'auth'] },
      tabelas: snapshot.tabelas,
      authUsuariosSha256: snapshot.auth.sha256,
      usuariosSemAuth: 0,
      roles: snapshot.roles,
      rolesPoliticas: snapshot.rolesPoliticas,
      extensoes: snapshot.extensoes,
      bucket: snapshot.bucket,
      objetos: storage.objetos,
      totais: {
        arquivos: storage.objetos.length,
        bytes: storage.bytes,
        baixados: storage.baixados,
        reutilizados: storage.reutilizados,
      },
    };
    writeFileSync(join(pasta, 'manifesto.json'), serializarManifesto(manifesto), {
      mode: 0o600,
    });
    console.log(
      JSON.stringify({
        backup: 'completo-public-auth-storage',
        arquivos: storage.objetos.length,
        bytes: storage.bytes,
        baixados: storage.baixados,
        reutilizados: storage.reutilizados,
      }),
    );
  } finally {
    await prisma.$disconnect();
  }
}
executar().catch(() => {
  console.error(
    'Backup falhou; nenhum pacote deve ser publicado. Consulte requisitos e refaça em ambiente restrito.',
  );
  process.exitCode = 1;
});
