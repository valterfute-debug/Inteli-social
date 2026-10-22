import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Front } from '@prisma/client';
import {
  AcaoAuditoria,
  AuditoriaService,
  calcularCamposAlterados,
} from '../auditoria/auditoria.service';
import { EscopoAcesso, ehAdmin, garantirUnidade } from '../auth/escopo';
import { PrismaService } from '../prisma/prisma.service';
import { PaginacaoQueryDto } from './dto/paginacao-query.dto';
import { ListarRacasQueryDto } from './dto/listar-racas-query.dto';
import { ListarLocalizacoesQueryDto } from './dto/listar-localizacoes-query.dto';
import { CriarResponsavelDto } from './dto/criar-responsavel.dto';
import { AtualizarResponsavelDto } from './dto/atualizar-responsavel.dto';

const NOMES_FRENTES: Record<Front, string> = {
  CCPA: 'Centro de Controle de População Animal',
  CASADOTE: 'CasAdote',
  CED: 'Captura, Esterilização e Devolução',
};

@Injectable()
export class CatalogosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listarEspecies({ pagina, limite }: PaginacaoQueryDto) {
    const where = { deletedAt: null };
    const [itens, total] = await Promise.all([
      this.prisma.species.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.species.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name, silvestre: item.silvestre })),
      pagina,
      limite,
      total,
    };
  }

  async listarRacas({ pagina, limite, especieId }: ListarRacasQueryDto) {
    const where = { speciesId: especieId };
    const [itens, total] = await Promise.all([
      this.prisma.breed.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.breed.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name, especieId: item.speciesId })),
      pagina,
      limite,
      total,
    };
  }

  /** Só as unidades em que o usuário pode trabalhar: é delas que sai o formulário de admissão. */
  async listarUnidades({ pagina, limite }: PaginacaoQueryDto, escopo: EscopoAcesso) {
    const where = {
      deletedAt: null,
      ...(escopo.todasUnidades ? {} : { id: { in: escopo.unidadeIds } }),
    };
    const [itens, total] = await Promise.all([
      this.prisma.unit.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.unit.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name })),
      pagina,
      limite,
      total,
    };
  }

  async listarLocalizacoes(
    { pagina, limite, unidadeId }: ListarLocalizacoesQueryDto,
    escopo: EscopoAcesso,
  ) {
    garantirUnidade(escopo, unidadeId);
    const where = { unitId: unidadeId };
    const [itens, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name, unidadeId: item.unitId })),
      pagina,
      limite,
      total,
    };
  }

  /** E-mail e telefone são dados pessoais de terceiros: só o administrador os vê na listagem. */
  async listarResponsaveis({ pagina, limite }: PaginacaoQueryDto, escopo: EscopoAcesso) {
    const where = { deletedAt: null, active: true };
    const [itens, total] = await Promise.all([
      this.prisma.responsible.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.responsible.count({ where }),
    ]);
    const comContato = ehAdmin(escopo);
    return {
      itens: itens.map((item) => this.mapearResponsavel(item, comContato)),
      pagina,
      limite,
      total,
    };
  }

  /**
   * O endereço mora no cadastro do responsável: corrigi-lo vale para todos os seus animais.
   * O responsável não pertence a uma unidade, então o operador só edita quem ainda não tem
   * animal ou tem ao menos um animal ativo nas suas unidades.
   */
  async atualizarResponsavel(id: string, dto: AtualizarResponsavelDto, escopo: EscopoAcesso) {
    const dados = {
      name: dto.nome?.trim(),
      endereco: dto.endereco,
      email: dto.email,
      telefone: dto.telefone,
    };
    if (Object.values(dados).every((valor) => valor === undefined)) {
      throw new BadRequestException('Informe ao menos um campo para atualizar');
    }
    if (dados.name !== undefined && dados.name.length < 2) {
      throw new BadRequestException('nome deve ter ao menos 2 caracteres');
    }
    return this.prisma.$transaction(async (tx) => {
      const atual = await tx.responsible.findFirst({ where: { id, deletedAt: null } });
      if (!atual) throw new NotFoundException('Responsável não encontrado');
      if (!escopo.todasUnidades) {
        const vinculo = { responsibleId: id, deletedAt: null };
        const [total, visiveis] = await Promise.all([
          tx.animal.count({ where: vinculo }),
          tx.animal.count({ where: { ...vinculo, unitId: { in: escopo.unidadeIds } } }),
        ]);
        if (total > 0 && visiveis === 0) {
          throw new ForbiddenException('Sem acesso a este responsável');
        }
      }
      const atualizado = await tx.responsible.update({ where: { id }, data: dados });
      // Só os nomes dos campos: e-mail e telefone não entram na trilha imutável.
      const alterados = calcularCamposAlterados(atual, dados);
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.RESPONSAVEL_ATUALIZADO,
        entidade: 'Responsible',
        entidadeId: id,
        camposAlterados: Object.fromEntries(
          Object.keys(alterados).map((campo) => [campo, { antes: null, depois: null }]),
        ),
      });
      return this.mapearResponsavel(atualizado, true);
    });
  }

  private mapearResponsavel(
    responsavel: {
      id: string;
      name: string;
      endereco: string | null;
      email: string | null;
      telefone: string | null;
    },
    comContato: boolean,
  ) {
    return {
      id: responsavel.id,
      nome: responsavel.name,
      endereco: responsavel.endereco,
      ...(comContato ? { email: responsavel.email, telefone: responsavel.telefone } : {}),
    };
  }

  async criarResponsavel(dto: CriarResponsavelDto, escopo: EscopoAcesso) {
    const nome = dto.nome.trim();
    if (nome.length < 2) throw new BadRequestException('nome deve ter ao menos 2 caracteres');
    const responsavel = await this.prisma.$transaction(async (tx) => {
      const criado = await tx.responsible.create({
        data: {
          name: nome,
          endereco: dto.endereco,
          email: dto.email,
          telefone: dto.telefone,
        },
      });
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.RESPONSAVEL_CRIADO,
        entidade: 'Responsible',
        entidadeId: criado.id,
      });
      return criado;
    });
    return {
      id: responsavel.id,
      nome: responsavel.name,
      endereco: responsavel.endereco,
      email: responsavel.email,
      telefone: responsavel.telefone,
    };
  }

  listarFrentes({ pagina, limite }: PaginacaoQueryDto) {
    const todas = (Object.keys(NOMES_FRENTES) as Front[]).map((codigo) => ({
      codigo,
      nome: NOMES_FRENTES[codigo],
    }));
    const inicio = (pagina - 1) * limite;
    return {
      itens: todas.slice(inicio, inicio + limite),
      pagina,
      limite,
      total: todas.length,
    };
  }
}
