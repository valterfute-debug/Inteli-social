import { ApiProperty } from '@nestjs/swagger';
import { TipoAtendimento } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

const LIMITE_TEXTO = 10000;

export class CriarAtendimentoClinicoDto {
  @ApiProperty({
    required: false,
    enum: TipoAtendimento,
    description:
      'Sem informar: ADMISSAO se o animal ainda não tem admissão, senão ACOMPANHAMENTO. Só existe uma admissão por animal',
  })
  @IsOptional()
  @IsEnum(TipoAtendimento)
  tipo?: TipoAtendimento;

  @ApiProperty({ required: false, description: 'Data do atendimento (ISO-8601); padrão: agora' })
  @IsOptional()
  @IsDateString()
  dataAtendimento?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: LIMITE_TEXTO })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_TEXTO)
  anamnese?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: LIMITE_TEXTO })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_TEXTO)
  exameFisico?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: LIMITE_TEXTO })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_TEXTO)
  examesComplementares?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: LIMITE_TEXTO })
  @IsOptional()
  @IsString()
  @MaxLength(LIMITE_TEXTO)
  tratamento?: string;
}
