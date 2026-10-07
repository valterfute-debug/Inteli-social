import { Injectable, NotFoundException } from '@nestjs/common';
import { EscopoAcesso, garantirUnidade } from '../auth/escopo';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { CriarEventoSaudeDto } from './dto/criar-evento-saude.dto';
import { ListarEventosSaudeQueryDto } from './dto/listar-eventos-saude-query.dto';
import { mapearEventoSaude } from './health-event.mapper';

@Injectable()
export class HealthEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
  ) {}

  private async garantirAnimalAcessivel(animalId: string, escopo: EscopoAcesso) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      select: { unitId: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, animal.unitId);
  }

  /** Com Idempotency-Key, o reenvio devolve o evento já registrado em vez de duplicá-lo. */
  async criar(animalId: string, dto: CriarEventoSaudeDto, escopo: EscopoAcesso, chave?: string) {
    await this.garantirAnimalAcessivel(animalId, escopo);
    const dados = {
      animalId,
      tipo: dto.tipo,
      descricao: dto.descricao,
      data: new Date(dto.data),
      observacoes: dto.observacoes,
    };

    if (!chave) {
      return {
        evento: mapearEventoSaude(await this.prisma.healthEvent.create({ data: dados })),
        reenvio: false,
      };
    }

    const { recursoId, resultado, reenvio } = await this.idempotencia.executar(
      {
        usuarioId: escopo.usuarioId,
        chave,
        operacao: `POST /animals/${animalId}/health-events`,
        conteudo: dto,
      },
      async (tx) => {
        const criado = await tx.healthEvent.create({ data: dados });
        return { recursoId: criado.id, resultado: criado };
      },
    );
    const evento =
      resultado ?? (await this.prisma.healthEvent.findUniqueOrThrow({ where: { id: recursoId } }));
    return { evento: mapearEventoSaude(evento), reenvio };
  }

  async listar(animalId: string, query: ListarEventosSaudeQueryDto, escopo: EscopoAcesso) {
    await this.garantirAnimalAcessivel(animalId, escopo);
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

  async arquivar(animalId: string, id: string, escopo: EscopoAcesso) {
    await this.garantirAnimalAcessivel(animalId, escopo);
    const resultado = await this.prisma.healthEvent.updateMany({
      where: { id, animalId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (resultado.count === 0) throw new NotFoundException('Evento de saúde não encontrado');
  }
}
