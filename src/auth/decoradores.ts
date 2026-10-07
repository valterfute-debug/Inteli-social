import {
  ExecutionContext,
  InternalServerErrorException,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { EscopoAcesso } from './escopo';
import { RequisicaoAutenticada, UsuarioAutenticado } from './tipos';

export const ROTA_PUBLICA = 'rotaPublica';

/** Libera a rota do login. Usar só em rotas sem dados (ex.: health check do Render). */
export const Publica = () => SetMetadata(ROTA_PUBLICA, true);

export const UsuarioAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): UsuarioAutenticado | undefined =>
    contexto.switchToHttp().getRequest<RequisicaoAutenticada>().usuario,
);

/** Escopo do usuário logado. Falha se usado numa rota pública (bug de programação, não do cliente). */
export const EscopoAtual = createParamDecorator(
  (_dado: unknown, contexto: ExecutionContext): EscopoAcesso => {
    const escopo = contexto.switchToHttp().getRequest<RequisicaoAutenticada>().escopo;
    if (!escopo) throw new InternalServerErrorException('Escopo de acesso não carregado');
    return escopo;
  },
);
