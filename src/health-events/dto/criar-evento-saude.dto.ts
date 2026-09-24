import { ApiProperty } from '@nestjs/swagger';
import { TipoEventoSaude } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';

export class CriarEventoSaudeDto {
  @ApiProperty({ enum: TipoEventoSaude })
  @IsEnum(TipoEventoSaude)
  tipo!: TipoEventoSaude;

  @ApiProperty({ required: false, nullable: true, description: 'Ex.: nome da vacina (V10, Raiva)' })
  @IsOptional()
  @IsString()
  descricao?: string;

  @ApiProperty({ description: 'Data em que o evento ocorreu (ISO-8601)' })
  @IsDateString()
  data!: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  observacoes?: string;
}
