import {
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
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import { lerChaveIdempotencia } from '../idempotencia/idempotencia.service';
import { SolicitarFotoDto } from './dto/solicitar-foto.dto';
import { FotosService } from './fotos.service';

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
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, true);
    return this.fotosService.solicitarEnvio(dto, escopo, chave);
  }

  @Post(':id/confirmacao')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirmar existência e validade do arquivo enviado' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  confirmar(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @EscopoAtual() escopo: EscopoAcesso,
  ) {
    const chave = lerChaveIdempotencia(idempotencyKey, true);
    return this.fotosService.confirmar(id, escopo, chave);
  }
}
