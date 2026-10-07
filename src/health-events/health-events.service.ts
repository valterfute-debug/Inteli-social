import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AcaoAuditoria, AuditoriaService } from '../auditoria/auditoria.service';
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
    private readonly auditoria: AuditoriaService,
  ) {}

  private async garantirAnimalAcessivel(animalId: string, escopo: EscopoAcesso) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      select: { unitId: true, front: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, animal.unitId);
    return animal;
  }

  /** Com Idempotency-Key, o reenvio devolve o evento já registrado em vez de duplicá-lo. */
  async criar(animalId: string, dto: CriarEventoSaudeDto, escopo: EscopoAcesso, chave?: string) {
    const animal = await this.garantirAnimalAcessivel(animalId, escopo);
    const dados = {
      animalId,
      tipo: dto.tipo,
      descricao: dto.descricao,
      data: new Date(dto.data),
      observacoes: dto.observacoes,
    };
    const criarComAuditoria = async (tx: Prisma.TransactionClient) => {
      const criado = await tx.healthEvent.create({ data: dados });
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.EVENTO_SAUDE_CRIADO,
        entidade: 'HealthEvent',
        entidadeId: criado.id,
        unidadeId: animal.unitId,
        frente: animal.front,
      });
      return { recursoId: criado.id, resultado: criado };
    };

    if (!chave) {
      const { resultado } = await this.prisma.$transaction(criarComAuditoria);
      return { evento: mapearEventoSaude(resultado), reenvio: false };
    }

    const { recursoId, resultado, reenvio } = await this.idempotencia.executar(
      {
        usuarioId: escopo.usuarioId,
        chave,
        operacao: `POST /animals/${animalId}/health-events`,
        conteudo: dto,
      },
      criarComAuditoria,
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
    const animal = await this.garantirAnimalAcessivel(animalId, escopo);
    await this.prisma.$transaction(async (tx) => {
      const resultado = await tx.healthEvent.updateMany({
        where: { id, animalId, deletedAt: null },
        data: { deletedAt: new Date() },
      });
      if (resultado.count === 0) throw new NotFoundException('Evento de saúde não encontrado');
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.EVENTO_SAUDE_ARQUIVADO,
        entidade: 'HealthEvent',
        entidadeId: id,
        unidadeId: animal.unitId,
        frente: animal.front,
      });
    });
  }
}
