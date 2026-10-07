import { ForbiddenException } from '@nestjs/common';
import { PapelUsuario } from '@prisma/client';

/**
 * O que o usuário logado pode acessar, carregado do banco a cada requisição.
 * Nunca é montado a partir de dados enviados pelo cliente.
 */
export interface EscopoAcesso {
  usuarioId: string;
  papel: PapelUsuario;
  /** ADMIN acessa todas as unidades; OPERADOR só as vinculadas a ele. */
  todasUnidades: boolean;
  unidadeIds: string[];
}

export function podeAcessarUnidade(escopo: EscopoAcesso, unitId: string) {
  return escopo.todasUnidades || escopo.unidadeIds.includes(unitId);
}

export function garantirUnidade(escopo: EscopoAcesso, unitId: string) {
  if (!podeAcessarUnidade(escopo, unitId)) {
    throw new ForbiddenException('Sem acesso a esta unidade');
  }
}

/** Trecho de `where` do Prisma que restringe a consulta às unidades do usuário. */
export function filtroPorUnidade(escopo: EscopoAcesso): { unitId?: { in: string[] } } {
  return escopo.todasUnidades ? {} : { unitId: { in: escopo.unidadeIds } };
}

export function ehAdmin(escopo: EscopoAcesso) {
  return escopo.papel === PapelUsuario.ADMIN;
}
