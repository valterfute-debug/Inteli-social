import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TipoAtendimento } from '@prisma/client';
import { AcaoAuditoria, AuditoriaService } from '../auditoria/auditoria.service';
import { UsuarioAutenticado } from '../auth/tipos';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { INCLUSAO_ATENDIMENTO, mapearAtendimentoClinico } from './atendimento-clinico.mapper';
import { AtualizarAtendimentoClinicoDto } from './dto/atualizar-atendimento-clinico.dto';
import { CriarAtendimentoClinicoDto } from './dto/criar-atendimento-clinico.dto';
import { ListarAtendimentosClinicosQueryDto } from './dto/listar-atendimentos-clinicos-query.dto';

const CAMPOS_ALTERAVEIS = [
  'dataAtendimento',
  'anamnese',
  'exameFisico',
  'examesComplementares',
  'tratamento',
] as const;

@Injectable()
export class AtendimentosClinicosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** Sem animal ativo (inexistente ou arquivado) não há prontuário. */
  private async obterAnimalAtivo(animalId: string) {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      select: { unitId: true, front: true, responsibleId: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    return animal;
  }

  async criar(
    animalId: string,
    dto: CriarAtendimentoClinicoDto,
    usuario: UsuarioAutenticado,
    chave: string,
  ) {
    const animal = await this.obterAnimalAtivo(animalId);
    const ctx = {
      usuarioId: usuario.id,
      chave,
      operacao: `POST /animals/${animalId}/atendimentos`,
      conteudo: dto,
    };
    const anterior = await this.idempotencia.verificarReenvio(ctx);
    if (anterior) {
      return { atendimento: await this.buscar(animalId, anterior), reenvio: true };
    }

    try {
      const { recursoId, resultado, reenvio } = await this.idempotencia.executar(
        ctx,
        async (tx) => {
          const temAdmissao =
            (await tx.atendimentoClinico.count({
              where: { animalId, tipo: TipoAtendimento.ADMISSAO, deletedAt: null },
            })) > 0;
          const tipo =
            dto.tipo ?? (temAdmissao ? TipoAtendimento.ACOMPANHAMENTO : TipoAtendimento.ADMISSAO);
          if (tipo === TipoAtendimento.ADMISSAO && temAdmissao) {
            throw new ConflictException('Este animal já tem um atendimento de admissão');
          }
          const criado = await tx.atendimentoClinico.create({
            data: {
              animalId,
              // Responsável vigente agora; mudanças futuras no animal não reescrevem este registro.
              responsibleId: animal.responsibleId,
              tipo,
              dataAtendimento: dto.dataAtendimento ? new Date(dto.dataAtendimento) : new Date(),
              anamnese: dto.anamnese,
              exameFisico: dto.exameFisico,
              examesComplementares: dto.examesComplementares,
              tratamento: dto.tratamento,
              criadoPorId: usuario.id,
            },
            include: INCLUSAO_ATENDIMENTO,
          });
          await this.auditoria.registrar(tx, {
            usuarioId: usuario.id,
            acao: AcaoAuditoria.ATENDIMENTO_CLINICO_CRIADO,
            entidade: 'AtendimentoClinico',
            entidadeId: criado.id,
            unidadeId: animal.unitId,
            frente: animal.front,
          });
          return { recursoId: criado.id, resultado: criado };
        },
      );
      if (reenvio || !resultado) {
        return { atendimento: await this.buscar(animalId, recursoId), reenvio: true };
      }
      return { atendimento: mapearAtendimentoClinico(resultado), reenvio: false };
    } catch (erro) {
      // Duas admissões simultâneas: o índice parcial do banco recusa a segunda.
      if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === 'P2002') {
        throw new ConflictException('Este animal já tem um atendimento de admissão');
      }
      throw erro;
    }
  }

  async listar(animalId: string, { pagina, limite }: ListarAtendimentosClinicosQueryDto) {
    await this.obterAnimalAtivo(animalId);
    const where = { animalId, deletedAt: null };
    const [itens, total] = await Promise.all([
      this.prisma.atendimentoClinico.findMany({
        where,
        include: INCLUSAO_ATENDIMENTO,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: [{ dataAtendimento: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.atendimentoClinico.count({ where }),
    ]);
    return { itens: itens.map(mapearAtendimentoClinico), pagina, limite, total };
  }

  async buscar(animalId: string, id: string) {
    await this.obterAnimalAtivo(animalId);
    const atendimento = await this.prisma.atendimentoClinico.findFirst({
      where: { id, animalId, deletedAt: null },
      include: INCLUSAO_ATENDIMENTO,
    });
    if (!atendimento) throw new NotFoundException('Atendimento clínico não encontrado');
    return mapearAtendimentoClinico(atendimento);
  }

  async atualizar(
    animalId: string,
    id: string,
    dto: AtualizarAtendimentoClinicoDto,
    usuario: UsuarioAutenticado,
  ) {
    const { versao, ...dados } = dto;
    if (Object.values(dados).every((valor) => valor === undefined)) {
      throw new BadRequestException('Informe ao menos um campo além da versão');
    }
    const animal = await this.obterAnimalAtivo(animalId);
    const existente = await this.prisma.atendimentoClinico.findFirst({
      where: { id, animalId, deletedAt: null },
    });
    if (!existente) throw new NotFoundException('Atendimento clínico não encontrado');
    if (existente.version !== versao) throw new ConflictException('Versão desatualizada');

    const alteracoes = {
      dataAtendimento: dados.dataAtendimento ? new Date(dados.dataAtendimento) : undefined,
      anamnese: dados.anamnese,
      exameFisico: dados.exameFisico,
      examesComplementares: dados.examesComplementares,
      tratamento: dados.tratamento,
    };
    // A trilha guarda quais seções mudaram, não o texto: o conteúdo clínico não vai para a auditoria.
    const camposAlterados = Object.fromEntries(
      CAMPOS_ALTERAVEIS.filter(
        (campo) =>
          alteracoes[campo] !== undefined &&
          JSON.stringify(alteracoes[campo]) !== JSON.stringify(existente[campo]),
      ).map((campo) => [campo, { antes: null, depois: null }]),
    );
    // Nada mudou de fato: não gasta versão nem enche a trilha de auditoria.
    if (Object.keys(camposAlterados).length === 0) return this.buscar(animalId, id);

    await this.prisma.$transaction(async (tx) => {
      const resultado = await tx.atendimentoClinico.updateMany({
        where: { id, animalId, deletedAt: null, version: versao },
        data: { ...alteracoes, version: { increment: 1 } },
      });
      // Outra edição venceu entre a leitura acima e esta escrita.
      if (resultado.count === 0) throw new ConflictException('Versão desatualizada');
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.ATENDIMENTO_CLINICO_ATUALIZADO,
        entidade: 'AtendimentoClinico',
        entidadeId: id,
        unidadeId: animal.unitId,
        frente: animal.front,
        camposAlterados,
      });
    });
    return this.buscar(animalId, id);
  }
}
