import { Front, Porte, Sexo } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CriarAnimalDto {
  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  nome?: string;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  microchip?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  especieId!: string;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @IsOptional()
  @IsUUID('4')
  racaId?: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  unidadeId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  localizacaoId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  responsavelId!: string;

  @ApiProperty({ enum: Front })
  @IsEnum(Front)
  frente!: Front;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsDateString()
  dataEntrada?: string;

  @ApiProperty({ required: false, nullable: true, enum: Sexo })
  @IsOptional()
  @IsEnum(Sexo)
  sexo?: Sexo;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  idadeAproximadaMeses?: number;

  @ApiProperty({ required: false, nullable: true, minimum: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  pesoKg?: number;

  @ApiProperty({ required: false, nullable: true, enum: Porte })
  @IsOptional()
  @IsEnum(Porte)
  porte?: Porte;

  @ApiProperty({ required: false, nullable: true })
  @IsOptional()
  @IsString()
  cor?: string;

  @ApiProperty({ required: false, nullable: true, description: 'Ex.: mancha branca na pata dianteira' })
  @IsOptional()
  @IsString()
  observacoes?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    description:
      'Foto de entrada já confirmada (ver POST /fotos). Temporariamente opcional até o fluxo de upload estar validado ponta a ponta.',
  })
  @IsOptional()
  @IsUUID('4')
  fotoEntradaId?: string;
}
