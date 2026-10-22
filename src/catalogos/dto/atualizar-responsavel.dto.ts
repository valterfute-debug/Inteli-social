import { PartialType } from '@nestjs/swagger';
import { CriarResponsavelDto } from './criar-responsavel.dto';

export class AtualizarResponsavelDto extends PartialType(CriarResponsavelDto) {}
