import { ApiPropertyOptional } from '@nestjs/swagger';
import { TipoEventoSaude } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListarEventosSaudeQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite: number = 20;

  @ApiPropertyOptional({ enum: TipoEventoSaude })
  @IsOptional()
  @IsEnum(TipoEventoSaude)
  tipo?: TipoEventoSaude;
}
