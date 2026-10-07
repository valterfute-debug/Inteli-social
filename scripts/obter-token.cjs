// Gera um access token do Supabase Auth para testar a API pelo terminal (curl, smoke test).
// Usa e-mail/senha de um usuário de TESTE criado no painel (Authentication > Users).
//
// Uso (PowerShell):  $env:TOKEN_EMAIL="..."; $env:TOKEN_SENHA="..."; npm run token
// Uso (bash):        TOKEN_EMAIL=... TOKEN_SENHA=... npm run token
//
// Precisa de SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no .env (a publishable key é pública).
require('dotenv').config({ quiet: true });

const url = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '');
const chavePublica = process.env.SUPABASE_PUBLISHABLE_KEY;
const email = process.env.TOKEN_EMAIL;
const senha = process.env.TOKEN_SENHA;

if (!url || !chavePublica || !email || !senha) {
  console.error(
    'Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY no .env, e TOKEN_EMAIL/TOKEN_SENHA no terminal.',
  );
  process.exit(1);
}

(async () => {
  const resposta = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: chavePublica, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha }),
  });
  const corpo = await resposta.json();
  if (!resposta.ok || !corpo.access_token) {
    console.error(`Login recusado (${resposta.status}): ${corpo.msg ?? corpo.error_description ?? 'erro'}`);
    process.exit(1);
  }
  // Só o token na saída, para poder usar em variável: $env:SMOKE_TOKEN = (npm run -s token)
  console.log(corpo.access_token);
})();
