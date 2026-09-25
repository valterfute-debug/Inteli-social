import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min } from 'class-validator';

export const TIPOS_MIDIA_ACEITOS = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type TipoMidiaAceito = (typeof TIPOS_MIDIA_ACEITOS)[number];

export const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

export class SolicitarFotoDto {
  @ApiProperty({ format: 'uuid', description: 'Identificador gerado pelo cliente para esta foto' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ enum: TIPOS_MIDIA_ACEITOS })
  @IsIn(TIPOS_MIDIA_ACEITOS)
  tipoMidia!: TipoMidiaAceito;

  @ApiProperty({ minimum: 1, maximum: TAMANHO_MAXIMO_BYTES })
  @IsInt()
  @Min(1)
  @Max(TAMANHO_MAXIMO_BYTES)
  tamanhoBytes!: number;
}
