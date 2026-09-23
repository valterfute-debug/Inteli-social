import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { PaginacaoQueryDto } from './paginacao-query.dto';

export class ListarLocalizacoesQueryDto extends PaginacaoQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4')
  unidadeId!: string;
}
