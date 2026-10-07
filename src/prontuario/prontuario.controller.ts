import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { EscopoAtual } from '../auth/decoradores';
import { EscopoAcesso } from '../auth/escopo';
import type { Response } from 'express';
import { ProntuarioService } from './prontuario.service';

@ApiTags('Prontuario')
@Controller({ path: 'animals/:id/prontuario', version: '1' })
export class ProntuarioController {
  constructor(private readonly prontuarioService: ProntuarioService) {}

  @Get()
  @ApiOperation({ summary: 'Gerar o PDF do prontuário do animal' })
  async gerar(
    @Param('id', ParseUUIDPipe) id: string,
    @EscopoAtual() escopo: EscopoAcesso,
    @Res() res: Response,
  ) {
    const pdf = await this.prontuarioService.gerarPdf(id, escopo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="prontuario-${id}.pdf"`);
    res.send(pdf);
  }
}
