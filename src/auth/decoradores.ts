import {
  ExecutionContext,
  InternalServerErrorException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { RequisicaoAutenticada, UsuarioAutenticado } from './tipos';

export const ROTA_PUBLICA = 'rotaPublica';

/** Libera a rota do login. Usar só em rotas sem dados (ex.: health check do Render). */
export const Publica = () => SetMetadata(ROTA_PUBLICA, true);

/** Conta logada e ativa. Falha se usado numa rota pública (bug de programação, não do cliente). */
export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): UsuarioAutenticado => {
    const usuario = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().usuario;
    if (!usuario) throw new InternalServerErrorException('Usuário não carregado');
    return usuario;
  },
);
