import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditoriaService } from './auditoria.service';
import { ListarAuditoriaQueryDto } from './dto/listar-auditoria-query.dto';

@ApiTags('Auditoria')
@Controller({ path: 'auditoria', version: '1' })
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar a trilha de auditoria (qualquer conta ativa)' })
  listar(@Query() query: ListarAuditoriaQueryDto) {
    return this.auditoriaService.listar(query);
  }
}
