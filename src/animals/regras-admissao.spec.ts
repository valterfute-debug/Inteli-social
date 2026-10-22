import { Front, Porte, Sexo } from '@prisma/client';
import { validarRegrasAdmissao } from './regras-admissao';

const COMPLETO = {
  microchip: '000123456789',
  sexo: Sexo.MACHO,
  idadeAproximadaMeses: 12,
  pesoKg: 8,
  porte: Porte.PEQUENO,
};

describe('validarRegrasAdmissao', () => {
  it.each([Front.CCPA, Front.CED])('%s exige os cinco campos de identificação', (frente) => {
    expect(validarRegrasAdmissao({ frente, especieSilvestre: false })).toEqual([
      `microchip é obrigatório para a frente ${frente}`,
      `sexo é obrigatório para a frente ${frente}`,
      `idade aproximada é obrigatório para a frente ${frente}`,
      `peso é obrigatório para a frente ${frente}`,
      `porte é obrigatório para a frente ${frente}`,
    ]);
  });

  it.each([Front.CCPA, Front.CED])('%s aceita cadastro completo', (frente) => {
    expect(validarRegrasAdmissao({ frente, especieSilvestre: false, ...COMPLETO })).toEqual([]);
  });

  it('aceita idade e peso iguais a zero (filhote recém-nascido)', () => {
    expect(
      validarRegrasAdmissao({
        frente: Front.CCPA,
        especieSilvestre: false,
        ...COMPLETO,
        idadeAproximadaMeses: 0,
        pesoKg: 0,
      }),
    ).toEqual([]);
  });

  it('CasAdote não exige campos adicionais (animal já passou por CCPA ou CED)', () => {
    expect(validarRegrasAdmissao({ frente: Front.CASADOTE, especieSilvestre: false })).toEqual([]);
  });

  it('silvestre exige nome e dispensa microchip em qualquer frente', () => {
    expect(validarRegrasAdmissao({ frente: Front.CED, especieSilvestre: true })).toEqual([
      'nome é obrigatório para animais silvestres',
    ]);
    expect(
      validarRegrasAdmissao({ frente: Front.CED, especieSilvestre: true, nome: '   ' }),
    ).toHaveLength(1);
    expect(
      validarRegrasAdmissao({ frente: Front.CED, especieSilvestre: true, nome: 'Onça Pintada' }),
    ).toEqual([]);
  });

  it('silvestre com nome e microchip: a regra não proíbe a coexistência (decisão da equipe pendente)', () => {
    expect(
      validarRegrasAdmissao({
        frente: Front.CED,
        especieSilvestre: true,
        nome: 'Jaguatirica',
        microchip: '000123456789',
      }),
    ).toEqual([]);
  });

  it('silvestre sem nome é recusado, mesmo com microchip', () => {
    expect(
      validarRegrasAdmissao({
        frente: Front.CCPA,
        especieSilvestre: true,
        nome: '  ',
        microchip: '000123456789',
      }),
    ).toEqual(['nome é obrigatório para animais silvestres']);
  });

  it('o microchip só passa como texto: zeros à esquerda não entram na regra de preenchimento', () => {
    expect(
      validarRegrasAdmissao({
        frente: Front.CED,
        especieSilvestre: false,
        ...COMPLETO,
        microchip: '0',
      }),
    ).toEqual([]);
  });
});
