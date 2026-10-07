// Teste de fumaça pós-deploy: confere que a API publicada responde e está ligada ao banco.
// Uso: npm run smoke -- https://inteli-social-api.onrender.com
const base = (process.argv[2] ?? process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');

const verificacoes = [
  ['API responde', '/api/health', (corpo) => corpo.status === 'ok'],
  ['Banco conectado', '/api/health/ready', (corpo) => corpo.banco === 'ok'],
  ['Frentes disponíveis', '/api/v1/fronts', (corpo) => corpo.total === 3],
  ['Catálogo de espécies populado (seed)', '/api/v1/species', (corpo) => corpo.total > 0],
  ['Catálogo de unidades populado (seed)', '/api/v1/units', (corpo) => corpo.total > 0],
  ['Listagem de animais', '/api/v1/animals?limite=1', (corpo) => Array.isArray(corpo.itens)],
];

(async () => {
  let falhas = 0;
  for (const [nome, rota, valida] of verificacoes) {
    try {
      const resposta = await fetch(base + rota, { signal: AbortSignal.timeout(60_000) });
      const corpo = await resposta.json();
      const ok = resposta.ok && valida(corpo);
      if (rota === '/api/health' && resposta.headers.get('x-powered-by')) {
        console.log('✗ Cabeçalho x-powered-by exposto (helmet inativo?)');
        falhas++;
      }
      console.log(`${ok ? '✓' : '✗'} ${nome} (${resposta.status})`);
      if (!ok) falhas++;
    } catch (erro) {
      console.log(`✗ ${nome}: ${erro.message}`);
      falhas++;
    }
  }
  console.log(falhas === 0 ? `\nTudo certo em ${base}` : `\n${falhas} verificação(ões) falharam em ${base}`);
  process.exitCode = falhas === 0 ? 0 : 1;
})();
