import { IsBoolean } from 'class-validator';

export class AlterarAcessoDto {
  @IsBoolean()
  ativo!: boolean;
}
