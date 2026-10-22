import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { lerChaveIdempotencia } from '../idempotencia/idempotencia.service';
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { AnimalsService } from './animals.service';
import { AtualizarAnimalDto } from './dto/atualizar-animal.dto';
import { CriarAnimalDto } from './dto/criar-animal.dto';
import { ListarAnimaisQueryDto } from './dto/listar-animais-query.dto';
import { ListarMovimentacoesQueryDto } from './dto/listar-movimentacoes-query.dto';

@ApiTags('Animals')
@Controller({ path: 'animals', version: '1' })
export class AnimalsController {
  constructor(private readonly animalsService: AnimalsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar animais ativos' })
  listar(@Query() query: ListarAnimaisQueryDto) {
    return this.animalsService.listar(query);
  }

  @Post()
  @ApiOperation({ summary: 'Cadastrar animal (admissão)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID v4 estável por cadastro',
  })
  async criar(
    @Body() dto: CriarAnimalDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, true);
    const { animal, reenvio } = await this.animalsService.criar(dto, usuario, chave);
    // 201 na primeira vez; 200 quando é o reenvio de um cadastro já feito.
    resposta.status(reenvio ? HttpStatus.OK : HttpStatus.CREATED);
    if (reenvio) resposta.setHeader('Idempotent-Replayed', 'true');
    return animal;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar animal' })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.animalsService.buscarPorId(id);
  }

  @Get(':id/movimentacoes')
  @ApiOperation({ summary: 'Linha do tempo de áreas e unidades do animal' })
  listarMovimentacoes(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListarMovimentacoesQueryDto,
  ) {
    return this.animalsService.listarMovimentacoes(id, query);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar animal verificando versão' })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarAnimalDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.animalsService.atualizar(id, dto, usuario);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquivar animal' })
  arquivar(@Param('id', ParseUUIDPipe) id: string, @UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.animalsService.arquivar(id, usuario);
  }
}
