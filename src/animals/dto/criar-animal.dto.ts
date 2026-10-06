import { Front, Porte, Sexo } from '@prisma/client';
import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CriarAnimalDto {
  @ApiProperty({
    required: false,
    nullable: true,
    maxLength: 120,
    description: 'Obrigatório para espécies silvestres (identificação por nome)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  nome?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    pattern: '^[0-9]{1,20}$',
    example: '000123456789',
    description:
      'Somente dígitos, guardado como texto para preservar zeros. Obrigatório em CCPA e CED; único entre animais ativos',
  })
  @IsOptional()
  @Matches(/^[0-9]{1,20}$/, { message: 'microchip deve conter apenas dígitos (até 20)' })
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

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 600 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  idadeAproximadaMeses?: number;

  @ApiProperty({ required: false, nullable: true, minimum: 0, maximum: 9999.99 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999.99)
  pesoKg?: number;

  @ApiProperty({ required: false, nullable: true, enum: Porte })
  @IsOptional()
  @IsEnum(Porte)
  porte?: Porte;

  @ApiProperty({ required: false, nullable: true, maxLength: 60 })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  cor?: string;

  @ApiProperty({
    required: false,
    nullable: true,
    maxLength: 2000,
    description: 'Ex.: mancha branca na pata dianteira',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacoes?: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Foto de entrada já confirmada (ver POST /fotos e POST /fotos/{id}/confirmacao)',
  })
  @IsUUID('4')
  fotoEntradaId!: string;
}
