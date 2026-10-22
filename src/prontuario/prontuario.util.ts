import { TipoAtendimento, TipoEventoSaude } from '@prisma/client';

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

const NOMES_TIPO_ATENDIMENTO: Record<TipoAtendimento, string> = {
  ADMISSAO: 'Admissão',
  ACOMPANHAMENTO: 'Acompanhamento',
};

export function traduzirTipoAtendimento(tipo: TipoAtendimento): string {
  return NOMES_TIPO_ATENDIMENTO[tipo];
}

/** Data no fuso da Ampara: um atendimento às 22h não pode aparecer com o dia seguinte (UTC). */
export function formatarDataLocal(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * O PDF usa fonte WinAnsi: caracteres fora dela (ex.: emoji) fariam o pdf-lib lançar erro e
 * derrubar o documento inteiro, então são trocados por "?". Quebras de linha viram espaço.
 */
export function sanitizarParaPdf(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}

/** Quebra um texto livre em linhas que cabem na largura; palavras maiores que a linha são partidas. */
export function quebrarTexto(
  texto: string,
  larguraDe: (trecho: string) => number,
  larguraMaxima: number,
): string[] {
  const linhas: string[] = [];
  for (const paragrafo of texto.split(/\r?\n/)) {
    let atual = '';
    for (const palavra of sanitizarParaPdf(paragrafo).split(/\s+/)) {
      if (!palavra) continue;
      const candidata = atual ? `${atual} ${palavra}` : palavra;
      if (larguraDe(candidata) <= larguraMaxima) {
        atual = candidata;
        continue;
      }
      if (atual) linhas.push(atual);
      atual = '';
      for (const caractere of palavra) {
        if (atual && larguraDe(atual + caractere) > larguraMaxima) {
          linhas.push(atual);
          atual = '';
        }
        atual += caractere;
      }
    }
    linhas.push(atual);
  }
  return linhas;
}
