import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CriarResponsavelDto {
  @ApiProperty({ minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  nome!: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  endereco?: string;

  @ApiProperty({ required: false, nullable: true, format: 'email', maxLength: 160 })
  @IsOptional()
  @IsEmail()
  @MaxLength(160)
  email?: string;

  @ApiProperty({ required: false, nullable: true, maxLength: 30, example: '(11) 91234-5678' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  telefone?: string;
}
