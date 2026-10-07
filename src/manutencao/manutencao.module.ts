import { Module } from '@nestjs/common';
import { ManutencaoService } from './manutencao.service';

@Module({ providers: [ManutencaoService], exports: [ManutencaoService] })
export class ManutencaoModule {}
