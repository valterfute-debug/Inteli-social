import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AnexoClinico, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { UsuarioAutenticado } from '../auth/tipos';
import { AcaoAuditoria, AuditoriaService } from '../auditoria/auditoria.service';
import {
  MAX_ANEXOS,
  MAX_TOTAL_BYTES,
  SolicitarAnexoDto,
  TIPOS_ANEXO,
  assinaturaCompativel,
} from './anexo.dto';

@Injectable()
export class AnexosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async atendimento(animalId: string, atendimentoId: string) {
    const item = await this.prisma.atendimentoClinico.findFirst({
      where: { id: atendimentoId, animalId, deletedAt: null, animal: { deletedAt: null } },
    });
    if (!item) throw new NotFoundException('Atendimento clínico não encontrado');
    return item;
  }

  private resumo(item: AnexoClinico) {
    return {
      id: item.id,
      nome: item.nome,
      tipoMidia: item.tipoMidia,
      tamanhoBytes: item.tamanhoBytes,
      confirmado: item.confirmado,
      criadoEm: item.createdAt.toISOString(),
    };
  }

  async listar(animalId: string, atendimentoId: string, usuario: UsuarioAutenticado) {
    await this.atendimento(animalId, atendimentoId);
    const itens = await this.prisma.anexoClinico.findMany({
      where: {
        atendimentoId,
        cancelado: false,
        OR: [{ confirmado: true }, { criadoPorId: usuario.id }],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return { itens: itens.map((item) => this.resumo(item)) };
  }

  async solicitar(
    animalId: string,
    atendimentoId: string,
    dto: SolicitarAnexoDto,
    usuario: UsuarioAutenticado,
  ) {
    await this.atendimento(animalId, atendimentoId);
    if ((await this.storage.situacaoBucket()) !== 'privado')
      throw new ConflictException('Armazenamento de anexos deve estar configurado como privado');
    const extensao = dto.nome.split('.').pop()?.toLowerCase() ?? '';
    const extensoes = TIPOS_ANEXO[dto.tipoMidia as keyof typeof TIPOS_ANEXO] as
      readonly string[] | undefined;
    if (
      !dto.nome.trim() ||
      [...dto.nome].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      /[\\/]/.test(dto.nome) ||
      !extensoes?.includes(extensao)
    )
      throw new BadRequestException('Nome ou extensão incompatível com o tipo do anexo');
    const expiraEm = new Date(Date.now() + 120 * 60 * 1000);
    // Trava por atendimento limita quantidade/total mesmo com uploads concorrentes.
    const item = await this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, atendimentoId);
      if (await tx.remocaoArquivo.findFirst({ where: { fotoId: dto.id } }))
        throw new ConflictException(
          'Anexo descartado; selecione o arquivo novamente com outro identificador',
        );
      const existente = await tx.anexoClinico.findUnique({ where: { id: dto.id } });
      if (existente) {
        if (existente.cancelado)
          throw new ConflictException('Anexo descartado; use outro identificador');
        if (existente.criadoPorId !== usuario.id)
          throw new ForbiddenException('Anexo de outro usuário');
        if (
          existente.atendimentoId !== atendimentoId ||
          existente.nome !== dto.nome ||
          existente.tipoMidia !== dto.tipoMidia ||
          existente.tamanhoBytes !== dto.tamanhoBytes
        )
          throw new ConflictException('Identificador do anexo já usado com outro conteúdo');
        if (existente.confirmado)
          throw new ConflictException('Anexo já confirmado; consulte a lista');
        return tx.anexoClinico.update({ where: { id: dto.id }, data: { expiraEm } });
      }
      const total = await tx.anexoClinico.aggregate({
        where: { atendimentoId, cancelado: false },
        _count: true,
        _sum: { tamanhoBytes: true },
      });
      if (
        total._count >= MAX_ANEXOS ||
        (total._sum.tamanhoBytes ?? 0) + dto.tamanhoBytes > MAX_TOTAL_BYTES
      )
        throw new BadRequestException(
          'Limite de 10 anexos ou 100 MiB por atendimento atingido; remova envios pendentes',
        );
      return tx.anexoClinico.create({
        data: {
          ...dto,
          atendimentoId,
          criadoPorId: usuario.id,
          caminhoArmazenamento: `exames/${atendimentoId}/${dto.id}.${extensao}`,
          expiraEm,
        },
      });
    });
    const { urlEnvio } = await this.storage.criarUrlEnvio(item.caminhoArmazenamento);
    return { ...this.resumo(item), urlEnvio, expiraEm: expiraEm.toISOString() };
  }

  private async obter(animalId: string, atendimentoId: string, id: string) {
    await this.atendimento(animalId, atendimentoId);
    const item = await this.prisma.anexoClinico.findFirst({
      where: { id, atendimentoId, cancelado: false },
    });
    if (!item) throw new NotFoundException('Anexo não encontrado');
    return item;
  }

  async confirmar(
    animalId: string,
    atendimentoId: string,
    id: string,
    usuario: UsuarioAutenticado,
  ) {
    const item = await this.obter(animalId, atendimentoId, id);
    if (item.criadoPorId !== usuario.id)
      throw new ForbiddenException('Somente o autor pode confirmar o envio');
    if (item.confirmado) return this.resumo(item);
    if (item.expiraEm.getTime() <= Date.now())
      throw new ConflictException('Prazo expirado; solicite novo link de envio');
    const meta = await this.storage.obterMetadados(item.caminhoArmazenamento);
    if (!meta) throw new ConflictException('Arquivo ainda não recebido pelo armazenamento');
    if (meta.tamanhoBytes !== item.tamanhoBytes || meta.tipoMidia !== item.tipoMidia)
      throw new BadRequestException('Tamanho ou tipo real do arquivo difere do informado');
    const inicio = await this.storage.obterInicioArquivo(item.caminhoArmazenamento);
    if (!assinaturaCompativel(item.tipoMidia, inicio))
      throw new BadRequestException('Conteúdo do arquivo incompatível com o formato');
    return this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, atendimentoId);
      const atual = await tx.anexoClinico.findUnique({ where: { id } });
      if (!atual || atual.cancelado) throw new NotFoundException('Anexo removido durante o envio');
      if (atual.confirmado) return this.resumo(atual);
      if (atual.expiraEm.getTime() <= Date.now()) throw new ConflictException('Prazo expirado');
      const salvo = await tx.anexoClinico.update({ where: { id }, data: { confirmado: true } });
      await this.auditoria.registrar(tx, {
        usuarioId: usuario.id,
        acao: AcaoAuditoria.ANEXO_CONFIRMADO,
        entidade: 'AnexoClinico',
        entidadeId: id,
      });
      return this.resumo(salvo);
    });
  }

  async leitura(animalId: string, atendimentoId: string, id: string) {
    const item = await this.obter(animalId, atendimentoId, id);
    if (!item.confirmado) throw new ConflictException('Anexo ainda não confirmado');
    if ((await this.storage.situacaoBucket()) !== 'privado')
      throw new ConflictException('Armazenamento de anexos deve ser privado');
    const urls = await this.storage.criarUrlsLeitura([item.caminhoArmazenamento]);
    const url = urls.get(item.caminhoArmazenamento);
    if (!url) throw new NotFoundException('Arquivo indisponível');
    return {
      url,
      expiraEm: new Date(Date.now() + this.storage.validadeLeituraSegundos() * 1000).toISOString(),
    };
  }

  /** Confirmados compõem o histórico; apenas envios pendentes podem ser descartados. */
  async descartar(
    animalId: string,
    atendimentoId: string,
    id: string,
    usuario: UsuarioAutenticado,
  ) {
    await this.atendimento(animalId, atendimentoId);
    return this.prisma.$transaction(async (tx) => {
      await this.bloquear(tx, atendimentoId);
      const item = await tx.anexoClinico.findFirst({
        where: { id, atendimentoId, cancelado: false },
      });
      if (!item) return { removido: true };
      if (item.criadoPorId !== usuario.id) throw new ForbiddenException('Anexo de outro usuário');
      if (item.confirmado)
        throw new ConflictException(
          'Anexo confirmado faz parte do histórico e não pode ser excluído',
        );
      // Tombstone durável também bloqueia reutilização do id/caminho após descarte.
      await tx.remocaoArquivo.upsert({
        where: { caminhoArmazenamento: item.caminhoArmazenamento },
        create: { fotoId: item.id, caminhoArmazenamento: item.caminhoArmazenamento },
        update: {},
      });
      await tx.anexoClinico.update({ where: { id }, data: { cancelado: true } });
      return { removido: true };
    });
  }

  private async bloquear(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }
}
