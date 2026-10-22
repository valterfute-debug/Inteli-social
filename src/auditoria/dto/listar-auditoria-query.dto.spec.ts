import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListarAuditoriaQueryDto } from './listar-auditoria-query.dto';

async function erros(entrada: Record<string, unknown>) {
  return validate(plainToInstance(ListarAuditoriaQueryDto, entrada));
}

describe('ListarAuditoriaQueryDto', () => {
  it.each(['Animal', 'HealthEvent', 'Foto', 'Responsible', 'AtendimentoClinico'])(
    'aceita filtrar pela entidade %s',
    async (entidade) => {
      expect(await erros({ entidade })).toHaveLength(0);
    },
  );

  it('recusa entidade que a trilha não registra', async () => {
    const resultado = await erros({ entidade: 'Usuario' });

    expect(resultado).toHaveLength(1);
    expect(resultado[0].property).toBe('entidade');
  });

  it('usa 50 por página como padrão', () => {
    expect(plainToInstance(ListarAuditoriaQueryDto, {}).limite).toBe(50);
  });
});
