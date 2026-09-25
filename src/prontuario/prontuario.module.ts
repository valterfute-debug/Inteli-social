import { Module } from '@nestjs/common';
import { ProntuarioController } from './prontuario.controller';
import { ProntuarioService } from './prontuario.service';

@Module({
  controllers: [ProntuarioController],
  providers: [ProntuarioService],
})
export class ProntuarioModule {}
