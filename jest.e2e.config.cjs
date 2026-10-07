// Testes ponta a ponta: API inteira + PostgreSQL de verdade (local ou serviço do CI).
// Uso: E2E_DATABASE_URL=postgresql://postgres@localhost:5432/ampara_e2e npm run test:e2e
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  setupFiles: ['<rootDir>/test/e2e/ambiente-e2e.cjs'],
  transform: { '^.+[.]ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  testEnvironment: 'node',
  testTimeout: 30000,
};
