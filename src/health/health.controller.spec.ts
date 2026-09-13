import { Test } from '@nestjs/testing';
import { HealthController } from './health.controller';
describe('Controller de saúde', () => {
  it('informa disponibilidade da aplicação', async () => {
    const module = await Test.createTestingModule({ controllers: [HealthController] }).compile();
    expect(module.get(HealthController).check().status).toBe('ok');
  });
});
