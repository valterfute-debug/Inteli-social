const SwaggerParser = require('@apidevtools/swagger-parser');
const fs = require('node:fs');
(async () => {
  const contrato = JSON.parse(fs.readFileSync('contracts/openapi.json', 'utf8'));
  await SwaggerParser.validate(contrato);
  for (const [rota, item] of Object.entries(contrato.paths)) {
    for (const metodo of ['get', 'post', 'patch', 'delete']) {
      const operacao = item[metodo];
      if (!operacao) continue;
      if (!['implementado', 'planejado'].includes(operacao['x-situacao']))
        throw new Error('Situação ausente: ' + rota);
      if (operacao['x-situacao'] === 'implementado' && rota !== '/api/health')
        throw new Error('Endpoint indevidamente declarado implementado');
    }
  }
  console.log('Contrato OpenAPI válido; situações dos endpoints conferidas.');
})().catch(() => {
  console.error('Falha na validação OpenAPI. Revise contracts/openapi.json.');
  process.exitCode = 1;
});
