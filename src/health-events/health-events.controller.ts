import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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
  ) {
    return this.healthEventsService.listar(animalId, query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Registrar evento de saúde (vacina, vermífugo ou castração)' })
  criar(@Param('animalId', ParseUUIDPipe) animalId: string, @Body() dto: CriarEventoSaudeDto) {
    return this.healthEventsService.criar(animalId, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquivar um evento de saúde cadastrado por engano' })
  arquivar(
    @Param('animalId', ParseUUIDPipe) animalId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.healthEventsService.arquivar(animalId, id);
  }
}
