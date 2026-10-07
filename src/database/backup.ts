import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

/**
 * Backup do banco (pg_dump, formato custom) e das fotos do Storage, com manifesto de
 * conferência. Só leitura na origem.
 *
 *   npm run backup -- --destino ./backups      (PG_DUMP=caminho do pg_dump, se não estiver no PATH)
 */
async function listarArquivos(supabase: SupabaseClient, bucket: string, pasta = '') {
  const caminhos: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(pasta, { limit: 1000, offset });
    if (error) throw new Error(`Falha ao listar ${pasta || '/'}: ${error.message}`);
    for (const item of data) {
      const caminho = pasta ? `${pasta}/${item.name}` : item.name;
      // Sem id = pasta.
      if (item.id) caminhos.push(caminho);
      else caminhos.push(...(await listarArquivos(supabase, bucket, caminho)));
    }
    if (data.length < 1000) return caminhos;
  }
}

async function executar() {
  const { values } = parseArgs({ options: { destino: { type: 'string', default: 'backups' } } });
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? 'fotos-animais';
  if (!url || !supabaseUrl || !chave) {
    throw new Error(
      'Defina DIRECT_URL (ou DATABASE_URL), SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  const pasta = join(values.destino, new Date().toISOString().replace(/[:.]/g, '-'));
  mkdirSync(join(pasta, 'storage'), { recursive: true });

  const arquivoBanco = join(pasta, 'banco.dump');
  execFileSync(
    process.env.PG_DUMP ?? 'pg_dump',
    [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--schema=public',
      `--file=${arquivoBanco}`,
      url,
    ],
    { stdio: 'inherit' },
  );

  const supabase = createClient(supabaseUrl, chave, { auth: { persistSession: false } });
  const arquivos = await listarArquivos(supabase, bucket);
  const fotos: Record<string, string> = {};
  for (const caminho of arquivos) {
    const { data, error } = await supabase.storage.from(bucket).download(caminho);
    if (error || !data) throw new Error(`Falha ao baixar ${caminho}: ${error?.message}`);
    const conteudo = Buffer.from(await data.arrayBuffer());
    const destino = join(pasta, 'storage', caminho);
    mkdirSync(join(destino, '..'), { recursive: true });
    writeFileSync(destino, conteudo);
    fotos[caminho] = createHash('sha256').update(conteudo).digest('hex');
  }

  writeFileSync(
    join(pasta, 'manifesto.json'),
    JSON.stringify({ criadoEm: new Date().toISOString(), bucket, fotos }, null, 2),
  );
  console.log(`Backup em ${pasta}: banco.dump + ${arquivos.length} foto(s)`);
}

executar().catch((erro: unknown) => {
  console.error((erro as Error).message);
  process.exitCode = 1;
});
