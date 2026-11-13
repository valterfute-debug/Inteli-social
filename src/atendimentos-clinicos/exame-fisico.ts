import { BadRequestException } from '@nestjs/common';

export const CAMPOS_EXAME_FISICO = [
  'frequenciaRespiratoria',
  'frequenciaCardiaca',
  'tpc',
  'mucosa',
  'linfonodos',
  'temperatura',
] as const;

/** Validação de integridade, sem inferir faixas de normalidade clínica. */
export function validarExameFisico(dados: object) {
  const valores = dados as Record<string, unknown>;
  const invalidos = CAMPOS_EXAME_FISICO.filter((campo) => {
    const valor = valores[campo];
    if (campo === 'mucosa' || campo === 'linfonodos')
      return typeof valor !== 'string' || !valor.trim() || valor.length > 500;
    return (
      typeof valor !== 'number' ||
      !Number.isFinite(valor) ||
      (campo !== 'temperatura' && valor < 0) ||
      ((campo === 'frequenciaRespiratoria' || campo === 'frequenciaCardiaca') &&
        (!Number.isInteger(valor) || valor > 2147483647))
    );
  });
  if (invalidos.length)
    throw new BadRequestException(
      `Preencha os parâmetros obrigatórios do exame físico: ${invalidos.join(', ')}`,
    );
}
