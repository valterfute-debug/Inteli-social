import { Prisma } from '@prisma/client';
import { resolverRequisicaoId } from '../requisicao/contexto-requisicao';
import { calcularCamposAlterados } from './auditoria.service';

describe('calcularCamposAlterados', () => {
  it('registra só o que mudou, com antes e depois', () => {
    const atual = { name: 'Luna', cor: 'Preta', unitId: 'u1' };
    const novos = { name: 'Luna', cor: 'Caramelo', unitId: undefined };

    expect(calcularCamposAlterados(atual, novos)).toEqual({
      cor: { antes: 'Preta', depois: 'Caramelo' },
    });
  });

  it('compara Decimal com número e datas pelo instante', () => {
    const atual = {
      pesoKg: new Prisma.Decimal(12.5),
      dataEntrada: new Date('2026-10-01T00:00:00.000Z'),
    };
    expect(
      calcularCamposAlterados(atual, {
        pesoKg: 12.5,
        dataEntrada: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ).toEqual({});
    expect(calcularCamposAlterados(atual, { pesoKg: 13 })).toEqual({
      pesoKg: { antes: 12.5, depois: 13 },
    });
  });

  it('apagar um valor (null) também é alteração', () => {
    expect(calcularCamposAlterados({ microchip: '123' }, { microchip: null })).toEqual({
      microchip: { antes: '123', depois: null },
    });
  });
});

describe('resolverRequisicaoId', () => {
  it('reaproveita o ID enviado pelo cliente quando é seguro para log', () => {
    expect(resolverRequisicaoId('app-7f3a9c21')).toBe('app-7f3a9c21');
  });

  it.each([undefined, '', 'curto', 'tem espaço e\nquebra de linha', 'x'.repeat(65)])(
    'gera um novo para %p',
    (enviado) => {
      const id = resolverRequisicaoId(enviado);
      expect(id).not.toBe(enviado);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
    },
  );
});
