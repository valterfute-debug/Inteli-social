import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Front, Prisma } from '@prisma/client';
import {
  AcaoAuditoria,
  AuditoriaService,
  calcularCamposAlterados,
} from '../auditoria/auditoria.service';
import { UsuarioAutenticado } from '../auth/tipos';
import { PrismaService } from '../prisma/prisma.service';
import { PaginacaoQueryDto } from './dto/paginacao-query.dto';
import { ListarRacasQueryDto } from './dto/listar-racas-query.dto';
import { ListarLocalizacoesQueryDto } from './dto/listar-localizacoes-query.dto';
import { CriarResponsavelDto } from './dto/criar-responsavel.dto';
import { AtualizarResponsavelDto } from './dto/atualizar-responsavel.dto';
import { CriarRacaDto } from './dto/criar-raca.dto';
import { AtualizarRacaDto } from './dto/atualizar-raca.dto';

const NOMES_FRENTES: Record<Front, string> = {
  CCPA: 'Centro de Controle de População Animal',
  CASADOTE: 'CasAdote',
  CED: 'Captura, Esterilização e Devolução',
  MANTENEDOR: 'Mantenedor',
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

  private normalizarNomeRaca(nome: string) {
    const normalizado = nome.normalize('NFC').trim().replace(/\s+/gu, ' ');
    if (normalizado.length < 2 || normalizado.length > 120) {
      throw new BadRequestException('nome deve ter entre 2 e 120 caracteres');
    }
    return normalizado;
  }

  private async validarRaca(
    tx: Prisma.TransactionClient,
    especieId: string,
    nome: string,
    id?: string,
  ) {
    // Serializa as escritas da espécie, incluindo nomes com caixa diferente.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`breed:${especieId}`}, 0))`;
    const especie = await tx.species.findFirst({ where: { id: especieId, deletedAt: null } });
    if (!especie) throw new NotFoundException('Espécie não encontrada ou inativa');
    const duplicada = await tx.breed.findFirst({
      where: {
        speciesId: especieId,
        name: { equals: nome, mode: 'insensitive' },
        ...(id ? { id: { not: id } } : {}),
      },
    });
    if (duplicada) throw new ConflictException('Já existe uma raça com esse nome nesta espécie');
  }

  async criarRaca(dto: CriarRacaDto, usuario: UsuarioAutenticado) {
    const nome = this.normalizarNomeRaca(dto.nome);
    return this.prisma.$transaction(async (tx) => {
      await this.validarRaca(tx, dto.especieId, nome);
      const criada = await tx.breed.create({ data: { name: nome, speciesId: dto.especieId } });
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.RACA_CRIADA,
        entidade: 'Breed',
        entidadeId: criada.id,
      });
      return { id: criada.id, nome: criada.name, especieId: criada.speciesId };
    });
  }

  async atualizarRaca(id: string, dto: AtualizarRacaDto, usuario: UsuarioAutenticado) {
    const nome = this.normalizarNomeRaca(dto.nome);
    return this.prisma.$transaction(async (tx) => {
      const atual = await tx.breed.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('Raça não encontrada');
      await this.validarRaca(tx, atual.speciesId, nome, id);
      const anterior = await tx.breed.findUniqueOrThrow({ where: { id } });
      const atualizada = await tx.breed.update({ where: { id }, data: { name: nome } });
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.RACA_ATUALIZADA,
        entidade: 'Breed',
        entidadeId: id,
        camposAlterados: calcularCamposAlterados(anterior, { name: nome }),
      });
      return { id: atualizada.id, nome: atualizada.name, especieId: atualizada.speciesId };
    });
  }

  /** Todas as unidades ativas: qualquer conta cadastra e consulta em qualquer unidade. */
  async listarUnidades({ pagina, limite }: PaginacaoQueryDto) {
    const where = { deletedAt: null };
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

  async listarLocalizacoes({ pagina, limite, unidadeId }: ListarLocalizacoesQueryDto) {
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

  /** Todas as contas ativas têm as mesmas permissões: a lista traz nome, endereço e contato. */
  async listarResponsaveis({ pagina, limite }: PaginacaoQueryDto) {
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
    return {
      itens: itens.map((item) => this.mapearResponsavel(item)),
      pagina,
      limite,
      total,
    };
  }

  /** O endereço mora no cadastro do responsável: corrigi-lo vale para todos os seus animais. */
  async atualizarResponsavel(
    id: string,
    dto: AtualizarResponsavelDto,
    usuario: UsuarioAutenticado,
  ) {
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
      const atualizado = await tx.responsible.update({ where: { id }, data: dados });
      // Só os nomes dos campos: e-mail e telefone não entram na trilha imutável.
      const alterados = calcularCamposAlterados(atual, dados);
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.RESPONSAVEL_ATUALIZADO,
        entidade: 'Responsible',
        entidadeId: id,
        camposAlterados: Object.fromEntries(
          Object.keys(alterados).map((campo) => [campo, { antes: null, depois: null }]),
        ),
      });
      return this.mapearResponsavel(atualizado);
    });
  }

  private mapearResponsavel(responsavel: {
    id: string;
    name: string;
    endereco: string | null;
    email: string | null;
    telefone: string | null;
  }) {
    return {
      id: responsavel.id,
      nome: responsavel.name,
      endereco: responsavel.endereco,
      email: responsavel.email,
      telefone: responsavel.telefone,
    };
  }

  async criarResponsavel(dto: CriarResponsavelDto, usuario: UsuarioAutenticado) {
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
        usuarioId: usuario.id,
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
