import {
  Body,
  Controller,
  Get,
  Headers,
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
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { lerChaveIdempotencia } from '../idempotencia/idempotencia.service';
import { AtendimentosClinicosService } from './atendimentos-clinicos.service';
import { AtualizarAtendimentoClinicoDto } from './dto/atualizar-atendimento-clinico.dto';
import { CriarAtendimentoClinicoDto } from './dto/criar-atendimento-clinico.dto';
import { ListarAtendimentosClinicosQueryDto } from './dto/listar-atendimentos-clinicos-query.dto';

@ApiTags('AtendimentosClinicos')
@Controller({ path: 'animals/:animalId/atendimentos', version: '1' })
export class AtendimentosClinicosController {
  constructor(private readonly atendimentosService: AtendimentosClinicosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar o histórico clínico do animal (mais recente primeiro)' })
  listar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Query() query: ListarAtendimentosClinicosQueryDto,
  ) {
    return this.atendimentosService.listar(animalId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar atendimento clínico (admissão ou acompanhamento)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID v4 estável por atendimento (evita duplicar na sincronização offline)',
  })
  async criar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Body() dto: CriarAtendimentoClinicoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, true);
    const { atendimento, reenvio } = await this.atendimentosService.criar(
      animalId,
      dto,
      usuario,
      chave,
    );
    resposta.status(reenvio ? HttpStatus.OK : HttpStatus.CREATED);
    if (reenvio) resposta.setHeader('Idempotent-Replayed', 'true');
    return atendimento;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar um atendimento clínico' })
  buscar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.atendimentosService.buscar(animalId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Completar ou corrigir um atendimento, verificando a versão' })
  atualizar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarAtendimentoClinicoDto,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    return this.atendimentosService.atualizar(animalId, id, dto, usuario);
  }
}
