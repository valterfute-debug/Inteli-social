import { Front, Porte, Sexo } from '@prisma/client';

/**
 * Estado final do animal (cadastro novo ou cadastro existente + alterações do PATCH)
 * sobre o qual as regras de admissão são avaliadas.
 */
export interface EstadoAdmissao {
  frente: Front;
  especieSilvestre: boolean;
  nome?: string | null;
  microchip?: string | null;
  sexo?: Sexo | null;
  idadeAproximadaMeses?: number | null;
  pesoKg?: number | null;
  porte?: Porte | null;
}

/**
 * Frentes de entrada do animal na Ampara. O CasAdote recebe animais que já passaram
 * por uma delas (mesmo microchip), por isso não repete as exigências.
 */
const FRENTES_DE_ENTRADA: ReadonlySet<Front> = new Set([Front.CCPA, Front.CED]);

const CAMPOS_OBRIGATORIOS_ENTRADA: ReadonlyArray<[keyof EstadoAdmissao, string]> = [
  ['microchip', 'microchip'],
  ['sexo', 'sexo'],
  ['idadeAproximadaMeses', 'idade aproximada'],
  ['pesoKg', 'peso'],
  ['porte', 'porte'],
];

function vazio(valor: unknown) {
  return (
    valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '')
  );
}

/**
 * Regras definidas com a Ampara (reunião de validação da ficha):
 * - Animais silvestres são identificados pelo nome; não se exige microchip nem os demais campos.
 * - CCPA e CED exigem microchip, sexo, idade aproximada, peso e porte.
 * - CasAdote não tem exigência adicional.
 *
 * Retorna a lista de violações (vazia quando o estado é válido).
 */
export function validarRegrasAdmissao(estado: EstadoAdmissao): string[] {
  if (estado.especieSilvestre) {
    return vazio(estado.nome) ? ['nome é obrigatório para animais silvestres'] : [];
  }

  if (!FRENTES_DE_ENTRADA.has(estado.frente)) return [];

  return CAMPOS_OBRIGATORIOS_ENTRADA.filter(([campo]) => vazio(estado[campo])).map(
    ([, rotulo]) => `${rotulo} é obrigatório para a frente ${estado.frente}`,
  );
}
