import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CriarEventoSaudeDto } from './dto/criar-evento-saude.dto';
import { ListarEventosSaudeQueryDto } from './dto/listar-eventos-saude-query.dto';
import { mapearEventoSaude } from './health-event.mapper';

@Injectable()
export class HealthEventsService {
  constructor(private readonly prisma: PrismaService) {}

  private async garantirAnimalAtivo(animalId: string) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      select: { id: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
  }

  async criar(animalId: string, dto: CriarEventoSaudeDto) {
    await this.garantirAnimalAtivo(animalId);
    const evento = await this.prisma.healthEvent.create({
      data: {
        animalId,
        tipo: dto.tipo,
        descricao: dto.descricao,
        data: new Date(dto.data),
        observacoes: dto.observacoes,
      },
    });
    return mapearEventoSaude(evento);
  }

  async listar(animalId: string, query: ListarEventosSaudeQueryDto) {
    await this.garantirAnimalAtivo(animalId);
    const { pagina, limite, tipo } = query;
    const where = {
      animalId,
      deletedAt: null,
      ...(tipo ? { tipo } : {}),
    };

    const [itens, total] = await Promise.all([
      this.prisma.healthEvent.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { data: 'desc' },
      }),
      this.prisma.healthEvent.count({ where }),
    ]);

    return { itens: itens.map(mapearEventoSaude), pagina, limite, total };
  }

  async arquivar(animalId: string, id: string) {
    const resultado = await this.prisma.healthEvent.updateMany({
      where: { id, animalId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (resultado.count === 0) throw new NotFoundException('Evento de saúde não encontrado');
  }
}
