// Teste de fumaça pós-deploy: confere que a API publicada responde, está ligada ao banco
// e exige login. Uso:
//   npm run smoke -- https://inteli-social-api.onrender.com
//   SMOKE_TOKEN=<access token> npm run smoke -- <url>   (também testa as rotas protegidas)
// O token pode ser obtido com `npm run token` (ver scripts/obter-token.cjs).
const base = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const token = process.env.SMOKE_TOKEN;

const publicas = [
  ['API responde', '/api/health', (corpo) => corpo.status === 'ok'],
  ['Banco conectado', '/api/health/ready', (corpo) => corpo.banco === 'ok'],
];

const protegidas = [
  ['Frentes disponíveis', '/api/v1/fronts', (corpo) => corpo.total === 3],
  ['Catálogo de espécies populado (seed)', '/api/v1/species', (corpo) => corpo.total > 0],
  ['Catálogo de unidades populado (seed)', '/api/v1/units', (corpo) => corpo.total > 0],
  ['Listagem de animais', '/api/v1/animals?limite=1', (corpo) => Array.isArray(corpo.itens)],
];

async function chamar(rota, comToken) {
  const resposta = await fetch(base + rota, {
    headers: comToken ? { Authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(60_000),
  });
  let corpo = null;
  try {
    corpo = await resposta.json();
  } catch {
    // corpo vazio ou não-JSON: a verificação decide pelo status
  }
  return { resposta, corpo };
}

(async () => {
  let falhas = 0;
  const registrar = (ok, texto) => {
    console.log(`${ok ? '✓' : '✗'} ${texto}`);
    if (!ok) falhas++;
  };

  for (const [nome, rota, valida] of publicas) {
    try {
      const { resposta, corpo } = await chamar(rota, false);
      registrar(resposta.ok && valida(corpo), `${nome} (${resposta.status})`);
      if (rota === '/api/health' && resposta.headers.get('x-powered-by')) {
        registrar(false, 'Cabeçalho x-powered-by exposto (helmet inativo?)');
      }
    } catch (erro) {
      registrar(false, `${nome}: ${erro.message}`);
    }
  }

  // Sem token, toda rota de dados precisa recusar: prova de que o login está ativo.
  for (const [nome, rota] of protegidas) {
    try {
      const { resposta } = await chamar(rota, false);
      registrar(resposta.status === 401, `${nome} recusada sem login (${resposta.status})`);
    } catch (erro) {
      registrar(false, `${nome} sem login: ${erro.message}`);
    }
  }

  if (!token) {
    console.log('\n(i) SMOKE_TOKEN não definido: rotas protegidas não foram testadas com login.');
  } else {
    for (const [nome, rota, valida] of protegidas) {
      try {
        const { resposta, corpo } = await chamar(rota, true);
        registrar(resposta.ok && valida(corpo), `${nome} com login (${resposta.status})`);
      } catch (erro) {
        registrar(false, `${nome} com login: ${erro.message}`);
      }
    }
  }

  console.log(falhas === 0 ? `\nTudo certo em ${base}` : `\n${falhas} verificação(ões) falharam em ${base}`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
