import { ApiProperty } from '@nestjs/swagger';
import { TipoAtendimento } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  IsNumber,
  IsInt,
  Min,
  Max,
} from 'class-validator';

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

  @ApiProperty({
    required: true,
    description: 'movimentos/minuto; obrigatório no atendimento clínico',
  })
  @IsOptional()
  @IsInt()
  @Max(2147483647)
  @Min(0)
  frequenciaRespiratoria?: number;

  @ApiProperty({
    required: true,
    description: 'batimentos/minuto; obrigatório no atendimento clínico',
  })
  @IsOptional()
  @IsInt()
  @Max(2147483647)
  @Min(0)
  frequenciaCardiaca?: number;

  @ApiProperty({ required: true, description: 'segundos; obrigatório no atendimento clínico' })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  tpc?: number;

  @ApiProperty({ required: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  mucosa?: string;

  @ApiProperty({ required: true, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  linfonodos?: string;

  @ApiProperty({
    required: true,
    description: 'graus Celsius; obrigatório no atendimento clínico',
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  temperatura?: number;
}
