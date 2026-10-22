import { UsuarioAutenticado } from '../src/auth/tipos';

/** Conta de teste: todas as contas ativas têm as mesmas permissões, então uma basta. */
export const USUARIO_TESTE: UsuarioAutenticado = { id: 'usuario-1', email: null };

export function outroUsuario(id: string): UsuarioAutenticado {
  return { id, email: null };
}
