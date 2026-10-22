import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { CriarAtendimentoClinicoDto } from './criar-atendimento-clinico.dto';

/** O tipo não muda depois de criado: trocar ACOMPANHAMENTO por ADMISSAO burlaria a admissão única. */
export class AtualizarAtendimentoClinicoDto extends PartialType(
  OmitType(CriarAtendimentoClinicoDto, ['tipo'] as const),
) {
  @ApiProperty({ minimum: 1, description: 'Versão esperada; divergência retorna 409' })
  @IsInt()
  @Min(1)
  versao!: number;
}
