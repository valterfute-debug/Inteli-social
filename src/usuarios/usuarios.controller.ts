import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermiteSenhaTemporaria, UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { UsuariosService } from './usuarios.service';

class NovaSenhaDto {
  @IsString() @MinLength(8) @MaxLength(72) senha!: string;
}

@ApiTags('Usuarios')
@Controller({ path: 'me', version: '1' })
export class UsuariosController {
  constructor(private readonly usuariosService: UsuariosService) {}

  @Get()
  @PermiteSenhaTemporaria()
  @ApiOperation({ summary: 'Dados da conta logada' })
  eu(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.usuariosService.obterPerfil(usuario);
  }

  @Post('trocar-senha-inicial')
  @PermiteSenhaTemporaria()
  trocarSenhaInicial(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: NovaSenhaDto) {
    return this.usuariosService.trocarSenhaInicial(usuario, dto.senha);
  }
}
