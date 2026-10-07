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
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import { AnimalsService } from './animals.service';
import { AtualizarAnimalDto } from './dto/atualizar-animal.dto';
import { CriarAnimalDto } from './dto/criar-animal.dto';
import { ListarAnimaisQueryDto } from './dto/listar-animais-query.dto';

@ApiTags('Animals')
@Controller({ path: 'animals', version: '1' })
export class AnimalsController {
  constructor(private readonly animalsService: AnimalsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar animais ativos' })
  listar(@Query() query: ListarAnimaisQueryDto, @EscopoAtual() escopo: EscopoAcesso) {
    return this.animalsService.listar(query, escopo);
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
    @EscopoAtual() escopo: EscopoAcesso,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, true);
    const { animal, reenvio } = await this.animalsService.criar(dto, escopo, chave);
    // 201 na primeira vez; 200 quando é o reenvio de um cadastro já feito.
    resposta.status(reenvio ? HttpStatus.OK : HttpStatus.CREATED);
    if (reenvio) resposta.setHeader('Idempotent-Replayed', 'true');
    return animal;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar animal' })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string, @EscopoAtual() escopo: EscopoAcesso) {
    return this.animalsService.buscarPorId(id, escopo);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar animal verificando versão' })
  atualizar(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarAnimalDto,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    return this.animalsService.atualizar(id, dto, escopo);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquivar animal' })
  arquivar(@Param('id', ParseUUIDPipe) id: string, @EscopoAtual() escopo: EscopoAcesso) {
    return this.animalsService.arquivar(id, escopo);
  }
}
