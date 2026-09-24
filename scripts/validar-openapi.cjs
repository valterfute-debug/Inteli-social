const SwaggerParser = require('@apidevtools/swagger-parser');
const fs = require('node:fs');

// Lista mantida manualmente: só rota+método aqui podem ser marcados "implementado".
// Isso obriga quem mexer no contrato a também atualizar esta lista, evitando que
// alguém declare um endpoint pronto sem o código existir de fato.
const ENDPOINTS_IMPLEMENTADOS = new Set([
  'GET /api/health',
  'GET /api/v1/animals',
  'POST /api/v1/animals',
  'GET /api/v1/animals/{id}',
  'PATCH /api/v1/animals/{id}',
  'DELETE /api/v1/animals/{id}',
  'GET /api/v1/species',
  'GET /api/v1/breeds',
  'GET /api/v1/units',
  'GET /api/v1/locations',
  'GET /api/v1/responsibles',
  'GET /api/v1/fronts',
  'GET /api/v1/animals/{animalId}/health-events',
  'POST /api/v1/animals/{animalId}/health-events',
  'DELETE /api/v1/animals/{animalId}/health-events/{id}',
  'GET /api/v1/animals/{id}/prontuario',
]);

(async () => {
  const contrato = JSON.parse(fs.readFileSync('contracts/openapi.json', 'utf8'));
  await SwaggerParser.validate(contrato);
  for (const [rota, item] of Object.entries(contrato.paths)) {
    for (const metodo of ['get', 'post', 'patch', 'delete']) {
      const operacao = item[metodo];
      if (!operacao) continue;
      if (!['implementado', 'planejado'].includes(operacao['x-situacao']))
        throw new Error('Situação ausente: ' + rota);
      const chave = metodo.toUpperCase() + ' ' + rota;
      if (operacao['x-situacao'] === 'implementado' && !ENDPOINTS_IMPLEMENTADOS.has(chave))
        throw new Error('Endpoint indevidamente declarado implementado: ' + chave);
    }
  }
  console.log('Contrato OpenAPI válido; situações dos endpoints conferidas.');
})().catch((erro) => {
  console.error('Falha na validação OpenAPI. Revise contracts/openapi.json.');
  console.error(erro.message);
  process.exitCode = 1;
});
