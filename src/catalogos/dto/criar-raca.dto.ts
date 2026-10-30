import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CriarRacaDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  especieId!: string;
}
