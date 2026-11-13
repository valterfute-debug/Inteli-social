import { IsIn, IsInt, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const TIPOS_ANEXO = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'video/mp4': ['mp4'],
  'video/webm': ['webm'],
  'video/quicktime': ['mov'],
} as const;
// Limites técnicos iniciais, sem alterar os limites da foto de entrada.
export const MAX_ANEXO_BYTES = 20 * 1024 * 1024;
export const MAX_ANEXOS = 10;
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

export class SolicitarAnexoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  id!: string;

  @ApiProperty({ maxLength: 180 })
  @IsString()
  @MaxLength(180)
  nome!: string;

  @ApiProperty({ enum: Object.keys(TIPOS_ANEXO) })
  @IsIn(Object.keys(TIPOS_ANEXO))
  tipoMidia!: string;

  @ApiProperty({ minimum: 1, maximum: MAX_ANEXO_BYTES })
  @IsInt()
  @Min(1)
  @Max(MAX_ANEXO_BYTES)
  tamanhoBytes!: number;
}

/** Assinatura mínima: não equivale a antivírus nem validação clínica do documento. */
export function assinaturaCompativel(tipo: string, inicio: Uint8Array): boolean {
  const b = Buffer.from(inicio);
  if (tipo === 'image/jpeg') return b.subarray(0, 3).equals(Buffer.from([255, 216, 255]));
  if (tipo === 'image/png')
    return b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (tipo === 'image/webp')
    return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
  if (tipo === 'application/pdf') return b.toString('ascii', 0, 5) === '%PDF-';
  if (tipo === 'application/msword')
    return b.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  if (tipo.includes('wordprocessingml'))
    return b.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  if (tipo === 'video/webm') return b.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
  if (tipo === 'video/mp4' || tipo === 'video/quicktime')
    return b.toString('ascii', 4, 8) === 'ftyp';
  return false;
}
