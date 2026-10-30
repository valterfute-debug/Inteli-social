import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** A espécie é imutável: trocar a raça de espécie invalidaria os animais vinculados. */
export class AtualizarRacaDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome!: string;
}
