import { TipoEventoSaude } from '@prisma/client';

export function formatarData(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

const NOMES_TIPO_EVENTO: Record<TipoEventoSaude, string> = {
  VACINA: 'Vacina',
  VERMIFUGO: 'Vermífugo',
  CASTRACAO: 'Castração',
};

export function traduzirTipoEvento(tipo: TipoEventoSaude): string {
  return NOMES_TIPO_EVENTO[tipo];
}
