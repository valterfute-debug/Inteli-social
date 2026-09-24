import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { SolicitarFotoDto } from './dto/solicitar-foto.dto';
import { FotosService } from './fotos.service';

function validarIdempotencyKey(valor: string | undefined) {
  if (!valor || !isUUID(valor, '4')) {
    throw new BadRequestException('Cabeçalho Idempotency-Key ausente ou inválido');
  }
}

@ApiTags('Fotos')
@Controller({ path: 'fotos', version: '1' })
export class FotosController {
  constructor(private readonly fotosService: FotosService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Solicitar envio de foto' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  solicitarEnvio(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: SolicitarFotoDto,
  ) {
    validarIdempotencyKey(idempotencyKey);
    return this.fotosService.solicitarEnvio(dto);
  }

  @Post(':id/confirmacao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar existência e validade do arquivo enviado' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  confirmar(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    validarIdempotencyKey(idempotencyKey);
    return this.fotosService.confirmar(id);
  }
}
