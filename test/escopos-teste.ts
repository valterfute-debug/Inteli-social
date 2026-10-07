import { PapelUsuario } from '@prisma/client';
import { EscopoAcesso } from '../src/auth/escopo';

export const ESCOPO_ADMIN: EscopoAcesso = {
  usuarioId: 'admin-1',
  papel: PapelUsuario.ADMIN,
  todasUnidades: true,
  unidadeIds: [],
};

export function escopoOperador(unidadeIds: string[], usuarioId = 'operador-1'): EscopoAcesso {
  return { usuarioId, papel: PapelUsuario.OPERADOR, todasUnidades: false, unidadeIds };
}
