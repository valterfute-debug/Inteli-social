import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { UsuarioAtual } from '../auth/decoradores';
import { UsuarioAutenticado } from '../auth/tipos';
import { SolicitarAnexoDto } from './anexo.dto';
import { AnexosService } from './anexos.service';

@ApiTags('AnexosClinicos')
@Controller({ path: 'animals/:animalId/atendimentos/:atendimentoId/anexos', version: '1' })
export class AnexosController {
  constructor(private readonly service: AnexosService) {}

  @Get()
  listar(
    @Param('animalId', ParseUUIDPipe) a: string,
    @Param('atendimentoId', ParseUUIDPipe) t: string,
    @UsuarioAtual() u: UsuarioAutenticado,
  ) {
    return this.service.listar(a, t, u);
  }

  @Post()
  solicitar(
    @Param('animalId', ParseUUIDPipe) a: string,
    @Param('atendimentoId', ParseUUIDPipe) t: string,
    @Body() dto: SolicitarAnexoDto,
    @UsuarioAtual() u: UsuarioAutenticado,
  ) {
    return this.service.solicitar(a, t, dto, u);
  }

  @Post(':id/confirmacao')
  confirmar(
    @Param('animalId', ParseUUIDPipe) a: string,
    @Param('atendimentoId', ParseUUIDPipe) t: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioAtual() u: UsuarioAutenticado,
  ) {
    return this.service.confirmar(a, t, id, u);
  }

  @Get(':id/leitura')
  leitura(
    @Param('animalId', ParseUUIDPipe) a: string,
    @Param('atendimentoId', ParseUUIDPipe) t: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.leitura(a, t, id);
  }

  @Delete(':id')
  descartar(
    @Param('animalId', ParseUUIDPipe) a: string,
    @Param('atendimentoId', ParseUUIDPipe) t: string,
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioAtual() u: UsuarioAutenticado,
  ) {
    return this.service.descartar(a, t, id, u);
  }
}
