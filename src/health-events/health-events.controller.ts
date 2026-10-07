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
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { lerChaveIdempotencia } from '../idempotencia/idempotencia.service';
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import { CriarEventoSaudeDto } from './dto/criar-evento-saude.dto';
import { ListarEventosSaudeQueryDto } from './dto/listar-eventos-saude-query.dto';
import { HealthEventsService } from './health-events.service';

@ApiTags('HealthEvents')
@Controller({ path: 'animals/:animalId/health-events', version: '1' })
export class HealthEventsController {
  constructor(private readonly healthEventsService: HealthEventsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar eventos de saúde de um animal' })
  listar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Query() query: ListarEventosSaudeQueryDto,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    return this.healthEventsService.listar(animalId, query, escopo);
  }

  @Post()
  @ApiOperation({ summary: 'Registrar evento de saúde (vacina, vermífugo ou castração)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'Recomendado na sincronização offline',
  })
  async criar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Body() dto: CriarEventoSaudeDto,
    @EscopoAtual() escopo: EscopoAcesso,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) resposta: Response,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, false);
    const { evento, reenvio } = await this.healthEventsService.criar(animalId, dto, escopo, chave);
    resposta.status(reenvio ? HttpStatus.OK : HttpStatus.CREATED);
    if (reenvio) resposta.setHeader('Idempotent-Replayed', 'true');
    return evento;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquivar um evento de saúde cadastrado por engano' })
  arquivar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    return this.healthEventsService.arquivar(animalId, id, escopo);
  }
}
