import { Module } from '@nestjs/common';
import { AtendimentosClinicosController } from './atendimentos-clinicos.controller';
import { AtendimentosClinicosService } from './atendimentos-clinicos.service';

@Module({
  controllers: [AtendimentosClinicosController],
  providers: [AtendimentosClinicosService],
})
export class AtendimentosClinicosModule {}
