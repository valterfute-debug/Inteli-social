import { Module } from '@nestjs/common';
import { EquipeController } from './equipe.controller';
import { EquipeService } from './equipe.service';
import { GerenciaEquipeGuard } from './gerencia-equipe.guard';
import { ConviteQrController } from './convite-qr.controller';
@Module({
  controllers: [EquipeController, ConviteQrController],
  providers: [EquipeService, GerenciaEquipeGuard],
})
export class EquipeModule {}
