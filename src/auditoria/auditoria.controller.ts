import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso, ehAdmin } from '../auth/escopo';
import { AuditoriaService } from './auditoria.service';
import { ListarAuditoriaQueryDto } from './dto/listar-auditoria-query.dto';

@ApiTags('Auditoria')
@Controller({ path: 'auditoria', version: '1' })
export class AuditoriaController {
  constructor(private readonly auditoriaService: AuditoriaService) {}

  @Get()
  @ApiOperation({ summary: 'Consultar a trilha de auditoria (somente ADMIN)' })
  listar(@Query() query: ListarAuditoriaQueryDto, @EscopoAtual() escopo: EscopoAcesso) {
    if (!ehAdmin(escopo)) throw new ForbiddenException('Auditoria restrita a administradores');
    return this.auditoriaService.listar(query);
  }
}
