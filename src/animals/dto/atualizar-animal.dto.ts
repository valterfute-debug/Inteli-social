import { ApiProperty, PartialType } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';
import { CriarAnimalDto } from './criar-animal.dto';

export class AtualizarAnimalDto extends PartialType(CriarAnimalDto) {
  @ApiProperty({ minimum: 1, description: 'Versão esperada; divergência retorna 409' })
  @IsInt()
  @Min(1)
  versao!: number;
}
