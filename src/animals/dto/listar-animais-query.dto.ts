import { Front } from '@prisma/client';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Apara espaços; texto vazio (campo de busca limpo no frontend) equivale a não filtrar. */
const aparar = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const aparado = value.trim();
  return aparado === '' ? undefined : aparado;
};

export class ListarAnimaisQueryDto {
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

  @ApiPropertyOptional({
    maxLength: 120,
    description:
      'Busca livre: nome (contém), identificador público (contém) ou microchip (começa com), sem diferenciar maiúsculas',
  })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  busca?: string;

  @ApiPropertyOptional({ description: 'Filtro por nome (contém, sem diferenciar maiúsculas)' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(120)
  nome?: string;

  @ApiPropertyOptional({ description: 'Identificador público exato, sem diferenciar maiúsculas' })
  @IsOptional()
  @Transform(aparar)
  @IsString()
  @MaxLength(40)
  identificadorPublico?: string;

  @ApiPropertyOptional({ description: 'Microchip exato (somente dígitos)' })
  @IsOptional()
  @Transform(aparar)
  @Matches(/^[0-9]{1,20}$/, { message: 'microchip deve conter apenas dígitos (até 20)' })
  microchip?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  especieId?: string;

  @ApiPropertyOptional({ enum: Front })
  @IsOptional()
  @IsEnum(Front)
  frente?: Front;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  unidadeId?: string;
}
