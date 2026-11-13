import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { AnexosService } from './anexos.service';
import { AnexosController } from './anexos.controller';
@Module({ imports: [StorageModule], providers: [AnexosService], controllers: [AnexosController] })
export class AnexosModule {}
