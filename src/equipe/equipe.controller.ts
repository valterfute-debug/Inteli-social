import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { AlterarAcessoDto } from './dto/alterar-acesso.dto';
import { IsBoolean, IsEmail, MaxLength } from 'class-validator';
class CadastrarContaDto {
  @IsEmail() @MaxLength(254) email!: string;
}
class AlterarAdministracaoDto {
  @IsBoolean() administrador!: boolean;
}
import { EquipeService } from './equipe.service';
import { GerenciaEquipeGuard } from './gerencia-equipe.guard';

@ApiTags('Equipe')
@UseGuards(GerenciaEquipeGuard)
@Controller({ path: 'equipe', version: '1' })
export class EquipeController {
  constructor(private readonly equipe: EquipeService) {}
  @Get()
  @ApiOperation({ summary: 'Listar contas da equipe' })
  listar() {
    return this.equipe.listar();
  }
  @Post('contas')
  cadastrar(@UsuarioAtual() usuario: UsuarioAutenticado, @Body() dto: CadastrarContaDto) {
    return this.equipe.cadastrar(usuario, dto.email);
  }
  @Post('convites-qr')
  criarConviteQr(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.equipe.criarConviteQr(usuario);
  }
  @Post(':id/redefinir-senha')
  redefinirSenha(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.equipe.redefinirSenha(usuario, id);
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

  @Patch(':id/administracao')
  alterarAdministracao(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AlterarAdministracaoDto,
  ) {
    return this.equipe.alterarAdministracao(usuario, id, dto.administrador);
  }
}
