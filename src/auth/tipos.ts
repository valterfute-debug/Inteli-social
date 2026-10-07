import { Request } from 'express';
import { EscopoAcesso } from './escopo';

export interface UsuarioAutenticado {
  /** `sub` do token: id do usuário no Supabase Auth. */
  id: string;
  email: string | null;
}

export interface RequisicaoAutenticada extends Request {
  usuario?: UsuarioAutenticado;
  escopo?: EscopoAcesso;
}
