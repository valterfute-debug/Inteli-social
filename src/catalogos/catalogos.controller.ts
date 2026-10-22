import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import { CatalogosService } from './catalogos.service';
import { PaginacaoQueryDto } from './dto/paginacao-query.dto';
import { ListarRacasQueryDto } from './dto/listar-racas-query.dto';
import { ListarLocalizacoesQueryDto } from './dto/listar-localizacoes-query.dto';
import { CriarResponsavelDto } from './dto/criar-responsavel.dto';
import { AtualizarResponsavelDto } from './dto/atualizar-responsavel.dto';

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
  listarUnidades(@Query() query: PaginacaoQueryDto, @EscopoAtual() escopo: EscopoAcesso) {
    return this.catalogosService.listarUnidades(query, escopo);
  }

  @Get('locations')
  @ApiOperation({ summary: 'Listar localizações' })
  listarLocalizacoes(
    @Query() query: ListarLocalizacoesQueryDto,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    return this.catalogosService.listarLocalizacoes(query, escopo);
  }

  @Get('responsibles')
  @ApiOperation({ summary: 'Listar responsáveis' })
  listarResponsaveis(@Query() query: PaginacaoQueryDto, @EscopoAtual() escopo: EscopoAcesso) {
    return this.catalogosService.listarResponsaveis(query, escopo);
  }

  @Post('responsibles')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastrar responsável (tutor ou quem entregou o animal)' })
  criarResponsavel(@Body() dto: CriarResponsavelDto, @EscopoAtual() escopo: EscopoAcesso) {
    return this.catalogosService.criarResponsavel(dto, escopo);
  }

  @Patch('responsibles/:id')
  @ApiOperation({ summary: 'Atualizar responsável (inclusive o endereço)' })
  atualizarResponsavel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AtualizarResponsavelDto,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    return this.catalogosService.atualizarResponsavel(id, dto, escopo);
  }

  @Get('fronts')
  @ApiOperation({ summary: 'Listar frentes' })
  listarFrentes(@Query() query: PaginacaoQueryDto) {
    return this.catalogosService.listarFrentes(query);
  }
}
