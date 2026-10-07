import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const LIMITE_BACKUP_BYTES = 60 * 1024 * 1024;
const RESERVA_MANIFESTO_BYTES = 1024 * 1024;
export interface BancoBackup {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<number>;
}
export interface ContagemTabela {
  esquema: 'public' | 'auth';
  tabela: string;
  quantidade: number;
}
export interface ObjetoStorage {
  id: string;
  caminho: string;
  atualizadoEm: string;
  tamanhoBytes: number;
  tipoMidia: string | null;
}
export interface ArquivoBackup extends ObjetoStorage {
  arquivo: string;
  sha256: string;
}
export interface ManifestoBackup {
  versao: 2;
  criadoEm: string;
  origem: string;
  backendSha: string;
  banco: {
    arquivo: 'banco.dump';
    tamanhoBytes: number;
    sha256: string;
    esquemas: ['public', 'auth'];
  };
  tabelas: ContagemTabela[];
  authUsuariosSha256: string;
  usuariosSemAuth: number;
  roles: Array<{ nome: string; login: boolean; superuser: boolean; bypassRls: boolean }>;
  rolesPoliticas: string[];
  extensoes: Array<{ nome: string; esquema: string; versao: string }>;
  bucket: {
    id: string;
    public: boolean;
    file_size_limit: number | null;
    allowed_mime_types: string[] | null;
  };
  objetos: ArquivoBackup[];
  totais: { arquivos: number; bytes: number; baixados: number; reutilizados: number };
}
export type ExecutarProcesso = typeof execFileSync;
export function sha256(conteudo: Buffer | string): string {
  return createHash('sha256').update(conteudo).digest('hex');
}
export function identificarOrigem(supabaseUrl: string, bucket: string): string {
  const url = new URL(supabaseUrl);
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('Origem Supabase inválida');
  return sha256(`${url.origin}/${bucket}`);
}
export function identificadorSQL(valor: string): string {
  return `"${valor.replaceAll('"', '""')}"`;
}

/** Credentials never appear in process arguments, output or thrown command errors. */
export function ambientePostgres(conexao: string): NodeJS.ProcessEnv {
  let url: URL;
  try {
    url = new URL(conexao);
  } catch {
    throw new Error('Conexão PostgreSQL inválida');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username)
    throw new Error('Conexão PostgreSQL inválida');
  const sslmode =
    url.searchParams.get('sslmode') ??
    (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ? 'disable' : 'require');
  if (!['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(sslmode))
    throw new Error('SSL PostgreSQL inválido');
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    TEMP: process.env.TEMP,
    PGHOST: url.hostname.replace(/^\[|\]$/g, ''),
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: sslmode,
    PGCONNECT_TIMEOUT: '15',
    PGOPTIONS: '-c timezone=UTC -c lock_timeout=10000 -c statement_timeout=180000',
  };
  if (!env.PGDATABASE || env.PGPORT === '6543')
    throw new Error('Use conexão direta ou session pooler, não transaction pooler');
  return env;
}
export function executarPg(
  ferramenta: string,
  args: string[],
  conexao: string,
  executar: ExecutarProcesso = execFileSync,
): Buffer {
  const env = ambientePostgres(conexao);
  try {
    const resultado = executar(ferramenta, args, {
      env,
      stdio: 'pipe',
      timeout: 180000,
      maxBuffer: 1024 * 1024,
    });
    return Buffer.from(resultado);
  } catch {
    throw new Error(
      'Ferramenta PostgreSQL falhou; confira versão, permissão e conexão sem publicar credenciais',
    );
  }
}
export function filtrarTocRestore(toc: string): string {
  // A newly-created database already has its empty public schema. Skip only
  // that CREATE SCHEMA, never constraints/data/triggers or restore errors.
  return toc
    .split('\n')
    .filter((line) => !/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s/.test(line))
    .join('\n');
}
export function validarDestinoRestore(conexao: string): string {
  const env = ambientePostgres(conexao);
  if (
    !['localhost', '127.0.0.1', '::1'].includes(env.PGHOST ?? '') ||
    !/^ampara_restore_[a-f0-9]{16}$/.test(env.PGDATABASE ?? '')
  )
    throw new Error('Restore exige host local e banco descartável ampara_restore_<16 hex>');
  return env.PGDATABASE!;
}
export async function verificarDestinoVazio(banco: BancoBackup): Promise<void> {
  const objetos = await banco.$queryRawUnsafe<Array<{ quantidade: bigint }>>(
    `SELECT count(*) AS quantidade FROM (
      SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
        AND c.relkind IN ('r','p','v','m','S','f')
      UNION ALL SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      UNION ALL SELECT t.oid FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema'
      UNION ALL SELECT n.oid FROM pg_namespace n
      WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname NOT IN ('information_schema','public')
    ) AS existentes`,
  );
  const local = await banco.$queryRawUnsafe<Array<{ local: boolean }>>(
    `SELECT inet_server_addr() IS NULL OR inet_server_addr() << inet '127.0.0.0/8' OR inet_server_addr() = inet '::1' AS local`,
  );
  if (
    objetos.length !== 1 ||
    local.length !== 1 ||
    !local[0].local ||
    quantidade(objetos[0].quantidade) !== 0
  )
    throw new Error('Destino não é local e vazio; restauração recusada');
}
function quantidade(valor: unknown): number {
  const n = typeof valor === 'bigint' ? Number(valor) : valor;
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0)
    throw new Error('Contagem do banco inválida');
  return n;
}
export async function contarTabelas(banco: BancoBackup): Promise<ContagemTabela[]> {
  const tabelas = await banco.$queryRawUnsafe<
    Array<{ esquema: 'public' | 'auth'; tabela: string }>
  >(
    `SELECT n.nspname::text AS esquema, c.relname::text AS tabela FROM pg_class c
     JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','auth')
     AND c.relkind IN ('r','p') ORDER BY n.nspname,c.relname`,
  );
  if (
    !tabelas.some((t) => t.esquema === 'auth' && t.tabela === 'users') ||
    !tabelas.some((t) => t.esquema === 'public' && t.tabela === 'Usuario')
  )
    throw new Error('Backup exige tabelas public.Usuario e auth.users');
  const resultado: ContagemTabela[] = [];
  for (const t of tabelas) {
    const rows = await banco.$queryRawUnsafe<Array<{ quantidade: bigint }>>(
      `SELECT count(*) AS quantidade FROM ${identificadorSQL(t.esquema)}.${identificadorSQL(t.tabela)}`,
    );
    if (rows.length !== 1) throw new Error('Contagem do banco inválida');
    resultado.push({ ...t, quantidade: quantidade(rows[0].quantidade) });
  }
  return resultado;
}
export async function integridadeAuth(
  banco: BancoBackup,
): Promise<{ sha256: string; semAuth: number }> {
  const [users, vinculos] = await Promise.all([
    banco.$queryRawUnsafe<Array<{ id: string; registro: unknown }>>(
      `SELECT id::text AS id,to_jsonb(u) AS registro FROM auth.users u ORDER BY id`,
    ),
    banco.$queryRawUnsafe<Array<{ quantidade: bigint }>>(
      `SELECT count(*) AS quantidade FROM public."Usuario" u LEFT JOIN auth.users a ON a.id::text=u.id WHERE a.id IS NULL`,
    ),
  ]);
  if (vinculos.length !== 1) throw new Error('Vínculo Auth inválido');
  return { sha256: sha256(JSON.stringify(users)), semAuth: quantidade(vinculos[0].quantidade) };
}
export async function listarObjetos(banco: BancoBackup, bucket: string): Promise<ObjetoStorage[]> {
  const rows = await banco.$queryRawUnsafe<
    Array<{
      id: string;
      caminho: string;
      atualizadoEm: Date;
      tamanho: unknown;
      tipoMidia: string | null;
    }>
  >(
    `SELECT id::text,name AS caminho,updated_at AS "atualizadoEm",metadata->>'size' AS tamanho,
     metadata->>'mimetype' AS "tipoMidia" FROM storage.objects WHERE bucket_id=$1 ORDER BY name`,
    bucket,
  );
  return rows.map((r) => {
    const tamanhoBytes =
      typeof r.tamanho === 'string' && /^\d+$/.test(r.tamanho) ? Number(r.tamanho) : NaN;
    if (
      !r.id ||
      !r.caminho ||
      !(r.atualizadoEm instanceof Date) ||
      !Number.isSafeInteger(tamanhoBytes) ||
      tamanhoBytes < 0
    )
      throw new Error('Metadados de Storage inválidos');
    return {
      id: r.id,
      caminho: r.caminho,
      atualizadoEm: r.atualizadoEm.toISOString(),
      tamanhoBytes,
      tipoMidia: r.tipoMidia,
    };
  });
}
export function validarManifesto(valor: unknown): ManifestoBackup {
  if (!valor || typeof valor !== 'object') throw new Error('Manifesto inválido');
  const m = valor as ManifestoBackup;
  const hash = /^[a-f0-9]{64}$/;
  if (
    m.versao !== 2 ||
    !hash.test(m.origem) ||
    !m.banco ||
    m.banco.arquivo !== 'banco.dump' ||
    !hash.test(m.banco.sha256) ||
    !Array.isArray(m.tabelas) ||
    !Array.isArray(m.objetos) ||
    !hash.test(m.authUsuariosSha256) ||
    !m.bucket ||
    typeof m.bucket.id !== 'string' ||
    !m.totais ||
    !Array.isArray(m.rolesPoliticas) ||
    !Array.isArray(m.extensoes)
  )
    throw new Error('Manifesto inválido');
  quantidade(m.banco.tamanhoBytes);
  quantidade(m.usuariosSemAuth);
  if (
    m.usuariosSemAuth !== 0 ||
    m.banco.esquemas?.join(',') !== 'public,auth' ||
    m.objetos.length > 10000
  )
    throw new Error('Manifesto incompleto');
  const nomes = new Set<string>();
  const arquivos = new Set<string>();
  for (const objeto of m.objetos) {
    if (
      typeof objeto.caminho !== 'string' ||
      !objeto.caminho ||
      typeof objeto.id !== 'string' ||
      !objeto.id ||
      !hash.test(objeto.sha256) ||
      !/^storage\/[a-f0-9]{64}\.bin$/.test(objeto.arquivo) ||
      nomes.has(objeto.caminho) ||
      arquivos.has(objeto.arquivo) ||
      objeto.arquivo !== `storage/${sha256(objeto.caminho)}.bin` ||
      !Number.isFinite(Date.parse(objeto.atualizadoEm)) ||
      (objeto.tipoMidia !== null && typeof objeto.tipoMidia !== 'string')
    )
      throw new Error('Objeto do manifesto inválido');
    quantidade(objeto.tamanhoBytes);
    nomes.add(objeto.caminho);
    arquivos.add(objeto.arquivo);
  }
  const tabelas = new Set<string>();
  for (const tabela of m.tabelas) {
    if (
      !['public', 'auth'].includes(tabela.esquema) ||
      typeof tabela.tabela !== 'string' ||
      !tabela.tabela ||
      tabelas.has(`${tabela.esquema}.${tabela.tabela}`)
    )
      throw new Error('Tabela do manifesto inválida');
    quantidade(tabela.quantidade);
    tabelas.add(`${tabela.esquema}.${tabela.tabela}`);
  }
  if (!tabelas.has('auth.users') || !tabelas.has('public.Usuario'))
    throw new Error('Manifesto sem tabelas obrigatórias Auth/Usuario');
  const bytes = m.banco.tamanhoBytes + m.objetos.reduce((total, o) => total + o.tamanhoBytes, 0);
  if (
    quantidade(m.totais.arquivos) !== m.objetos.length ||
    quantidade(m.totais.bytes) !== bytes ||
    quantidade(m.totais.baixados) + quantidade(m.totais.reutilizados) !== m.objetos.length ||
    bytes > LIMITE_BACKUP_BYTES - RESERVA_MANIFESTO_BYTES
  )
    throw new Error('Totais do manifesto inválidos ou acima do teto');
  return m;
}
/** The metadata reserve is only an early estimate. Enforce the real serialized size too. */
export function serializarManifesto(manifesto: ManifestoBackup): string {
  validarManifesto(manifesto);
  const conteudo = JSON.stringify(manifesto, null, 2);
  if (manifesto.totais.bytes + Buffer.byteLength(conteudo, 'utf8') > LIMITE_BACKUP_BYTES)
    throw new Error('Manifesto e arquivos excedem o teto descompactado do backup');
  return conteudo;
}
export function verificarArquivos(pasta: string, manifesto: ManifestoBackup): void {
  for (const arquivo of [manifesto.banco, ...manifesto.objetos]) {
    const conteudo = readFileSync(join(pasta, arquivo.arquivo));
    if (conteudo.length !== arquivo.tamanhoBytes || sha256(conteudo) !== arquivo.sha256)
      throw new Error('Integridade de arquivo do backup inválida');
  }
}
export async function copiarStorage(options: {
  pasta: string;
  origem: string;
  objetos: ObjetoStorage[];
  bytesBanco: number;
  anterior?: { pasta: string; manifesto: ManifestoBackup };
  baixar: (caminho: string) => Promise<Buffer>;
}): Promise<{ objetos: ArquivoBackup[]; baixados: number; reutilizados: number; bytes: number }> {
  const limite = LIMITE_BACKUP_BYTES - RESERVA_MANIFESTO_BYTES;
  let bytes = options.bytesBanco;
  if (
    options.objetos.length > 10000 ||
    bytes + options.objetos.reduce((n, o) => n + o.tamanhoBytes, 0) > limite
  )
    throw new Error('Backup excede teto gratuito configurado');
  const anteriores =
    options.anterior?.manifesto.origem === options.origem
      ? new Map(options.anterior.manifesto.objetos.map((o) => [o.caminho, o]))
      : new Map<string, ArquivoBackup>();
  const resultado: ArquivoBackup[] = [];
  let baixados = 0,
    reutilizados = 0;
  for (const objeto of options.objetos) {
    const arquivo = `storage/${sha256(objeto.caminho)}.bin`;
    const destino = join(options.pasta, arquivo);
    mkdirSync(dirname(destino), { recursive: true });
    const anterior = anteriores.get(objeto.caminho);
    let conteudo: Buffer | undefined;
    if (
      anterior &&
      anterior.id === objeto.id &&
      anterior.atualizadoEm === objeto.atualizadoEm &&
      anterior.tamanhoBytes === objeto.tamanhoBytes
    ) {
      try {
        const existente = readFileSync(join(options.anterior!.pasta, anterior.arquivo));
        if (existente.length === objeto.tamanhoBytes && sha256(existente) === anterior.sha256) {
          copyFileSync(join(options.anterior!.pasta, anterior.arquivo), destino);
          conteudo = existente;
          reutilizados++;
        }
      } catch {
        /* Missing/corrupt previous copy is fetched again, never silently trusted. */
      }
    }
    if (!conteudo) {
      conteudo = await options.baixar(objeto.caminho);
      writeFileSync(destino, conteudo, { mode: 0o600 });
      baixados++;
    }
    if (conteudo.length !== objeto.tamanhoBytes || bytes + conteudo.length > limite)
      throw new Error('Arquivo Storage mudou ou excedeu limite');
    bytes += conteudo.length;
    resultado.push({ ...objeto, arquivo, sha256: sha256(conteudo) });
  }
  return { objetos: resultado, baixados, reutilizados, bytes };
}
export async function verificarBancoRestaurado(
  banco: BancoBackup,
  m: ManifestoBackup,
): Promise<void> {
  await banco.$executeRawUnsafe(`SET TIME ZONE 'UTC'`);
  const contagens = await contarTabelas(banco);
  if (JSON.stringify(contagens) !== JSON.stringify(m.tabelas))
    throw new Error('Contagens restauradas divergem do snapshot');
  const auth = await integridadeAuth(banco);
  if (auth.semAuth !== 0 || auth.sha256 !== m.authUsuariosSha256)
    throw new Error('Usuários Auth ou seus vínculos UUID divergem');
  const fks = await banco.$queryRawUnsafe<Array<{ quantidade: bigint }>>(
    `SELECT count(*) AS quantidade FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname IN ('public','auth') AND c.contype='f' AND NOT c.convalidated`,
  );
  if (fks.length !== 1 || quantidade(fks[0].quantidade) !== 0)
    throw new Error('Chaves estrangeiras não validadas');
  const fichas = await banco.$queryRawUnsafe<
    Array<{ caminho: string | null; situacao: string | null }>
  >(
    `SELECT f."caminhoArmazenamento" AS caminho,f.situacao::text AS situacao FROM public."Animal" a LEFT JOIN public."Foto" f ON f.id=a."fotoEntradaId" WHERE a."fotoEntradaId" IS NOT NULL`,
  );
  const fotos = new Set(m.objetos.map((o) => o.caminho));
  if (fichas.some((f) => !f.caminho || f.situacao !== 'CONFIRMADA' || !fotos.has(f.caminho)))
    throw new Error('Ficha aponta para foto inválida ou ausente no backup');
}
export function dadosArquivo(arquivo: string): { tamanhoBytes: number; sha256: string } {
  return { tamanhoBytes: statSync(arquivo).size, sha256: sha256(readFileSync(arquivo)) };
}
