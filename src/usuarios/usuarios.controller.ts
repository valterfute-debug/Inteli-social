import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { UsuariosService } from './usuarios.service';

@ApiTags('Usuarios')
@Controller({ path: 'me', version: '1' })
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da conta logada' })
  eu(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.usuariosService.obterPerfil(usuario);
  }
}
