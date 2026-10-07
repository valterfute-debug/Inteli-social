import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListarAuditoriaQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pagina: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limite: number = 50;

  @ApiPropertyOptional({ enum: ['Animal', 'HealthEvent', 'Foto', 'Responsible'] })
  @IsOptional()
  @IsIn(['Animal', 'HealthEvent', 'Foto', 'Responsible'])
  entidade?: string;

  @ApiPropertyOptional({ description: 'Ex.: histórico de um animal' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entidadeId?: string;

  @ApiPropertyOptional({ description: 'Ações de uma pessoa (id do Supabase Auth)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  usuarioId?: string;

  @ApiPropertyOptional({ description: 'X-Request-Id informado num relato de erro' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  requisicaoId?: string;
}
