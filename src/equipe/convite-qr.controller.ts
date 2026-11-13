import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Publica } from '../auth/decoradores';
import { EquipeService } from './equipe.service';

class AceitarConviteQrDto {
  @IsString() @Matches(/^[A-Za-z0-9_-]{43}$/) token!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(8) @MaxLength(72) senha!: string;
}

@Controller({ path: 'convites-qr', version: '1' })
export class ConviteQrController {
  constructor(private readonly equipe: EquipeService) {}

  @Publica()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('aceitar')
  aceitar(@Body() dto: AceitarConviteQrDto) {
    return this.equipe.aceitarConviteQr(dto.token, dto.email, dto.senha);
  }
}
