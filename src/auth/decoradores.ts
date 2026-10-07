import { ExecutionContext, SetMetadata, createParamDecorator } from '@nestjs/common';
import { RequisicaoAutenticada, UsuarioAutenticado } from './tipos';

export const ROTA_PUBLICA = 'rotaPublica';

/** Libera a rota do login. Usar só em rotas sem dados (ex.: health check do Render). */
export const Publica = () => SetMetadata(ROTA_PUBLICA, true);

export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): UsuarioAutenticado | undefined =>
    contexto.switchToHttp().getRequest<RequisicaoAutenticada>().usuario,
);
