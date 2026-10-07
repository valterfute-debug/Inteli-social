// Os testes e2e APAGAM as tabelas antes de rodar: só aceitam banco local/descartável.
const url = process.env.E2E_DATABASE_URL;
if (!url) {
  throw new Error('Defina E2E_DATABASE_URL (PostgreSQL local, com as migrations aplicadas).');
}
const host = new URL(url).hostname;
if (!['localhost', '127.0.0.1', '::1'].includes(host)) {
  throw new Error(`E2E_DATABASE_URL precisa apontar para localhost (recebido: ${host}).`);
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = url;
process.env.DIRECT_URL = url;
process.env.SUPABASE_URL = 'https://projeto-teste.supabase.invalid';
process.env.LIMITE_REQUISICOES_POR_MINUTO = '10000';
