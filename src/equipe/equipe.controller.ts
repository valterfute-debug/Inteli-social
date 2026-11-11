import { Body, Controller, Get, Param, Patch, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { AlterarAcessoDto } from './dto/alterar-acesso.dto';
import { ConvidarDto } from './dto/convidar.dto';
import { EquipeService } from './equipe.service';

@ApiTags('Equipe')
@Controller({ path: 'equipe', version: '1' })
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}
  @Get()
  @ApiOperation({ summary: 'Listar contas da equipe' })
  listar() {
    return this.equipe.listar();
  }
  @Post('convites')
  @ApiOperation({ summary: 'Convidar uma pessoa por e-mail' })
  convidar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: ConvidarDto) {
    return this.equipe.convidar(usuario, dto.nome, dto.email);
  }
  @Patch(':id/acesso')
  @ApiOperation({ summary: 'Ativar ou desativar acesso' })
  alterar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AlterarAcessoDto,
  ) {
    return this.equipe.alterar(usuario, id, dto.ativo);
  }
}
