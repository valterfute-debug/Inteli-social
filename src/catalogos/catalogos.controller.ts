import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CatalogosService } from './catalogos.service';
import { PaginacaoQueryDto } from './dto/paginacao-query.dto';
import { ListarRacasQueryDto } from './dto/listar-racas-query.dto';
import { ListarLocalizacoesQueryDto } from './dto/listar-localizacoes-query.dto';

@ApiTags('Catalogos')
@Controller({ version: '1' })
export class CatalogosController {
  constructor(private readonly catalogosService: CatalogosService) {}

  @Get('species')
  @ApiOperation({ summary: 'Listar espécies' })
  listarEspecies(@Query() query: PaginacaoQueryDto) {
    return this.catalogosService.listarEspecies(query);
  }

  @Get('breeds')
  @ApiOperation({ summary: 'Listar raças' })
  listarRacas(@Query() query: ListarRacasQueryDto) {
    return this.catalogosService.listarRacas(query);
  }

  @Get('units')
  @ApiOperation({ summary: 'Listar unidades' })
  listarUnidades(@Query() query: PaginacaoQueryDto) {
    return this.catalogosService.listarUnidades(query);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Listar localizações' })
  listarLocalizacoes(@Query() query: ListarLocalizacoesQueryDto) {
    return this.catalogosService.listarLocalizacoes(query);
  }

  @Get('responsibles')
  @ApiOperation({ summary: 'Listar responsáveis' })
  listarResponsaveis(@Query() query: PaginacaoQueryDto) {
    return this.catalogosService.listarResponsaveis(query);
  }

  @Get('fronts')
  @ApiOperation({ summary: 'Listar frentes' })
  listarFrentes(@Query() query: PaginacaoQueryDto) {
    return this.catalogosService.listarFrentes(query);
  }
}
