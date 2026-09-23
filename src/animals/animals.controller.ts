import {
  Body,
  Controller,
  Delete,
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
  listar(@Query() query: ListarAnimaisQueryDto) {
    return this.animalsService.listar(query);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cadastrar animal (admissão)' })
  criar(@Body() dto: CriarAnimalDto) {
    return this.animalsService.criar(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar animal' })
  buscarPorId(@Param('id', ParseUUIDPipe) id: string) {
    return this.animalsService.buscarPorId(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar animal verificando versão' })
  atualizar(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarAnimalDto) {
    return this.animalsService.atualizar(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Arquivar animal' })
  arquivar(@Param('id', ParseUUIDPipe) id: string) {
    return this.animalsService.arquivar(id);
  }
}
