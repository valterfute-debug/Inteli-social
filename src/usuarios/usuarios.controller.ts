import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import { UsuariosService } from './usuarios.service';

@ApiTags('Usuarios')
@Controller({ path: 'me', version: '1' })
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Dados, papel e unidades do usuário logado' })
  eu(@EscopoAtual() escopo: EscopoAcesso) {
    return this.usuariosService.obterPerfil(escopo);
  }
}
