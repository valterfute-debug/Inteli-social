import { Module } from '@nestjs/common';
import { EquipeController } from './equipe.controller';
import { EquipeService } from './equipe.service';
import { GerenciaEquipeGuard } from './gerencia-equipe.guard';
@Module({ controllers: [EquipeController], providers: [EquipeService, GerenciaEquipeGuard] })
export class EquipeModule {}
