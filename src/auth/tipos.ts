import { Request } from 'express';

export interface UsuarioAutenticado {
  /** `sub` do token: id do usuário no Supabase Auth. */
  id: string;
  email: string | null;
}

export interface RequisicaoAutenticada extends Request {
  usuario?: UsuarioAutenticado;
}
