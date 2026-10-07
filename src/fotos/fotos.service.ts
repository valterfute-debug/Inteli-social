import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SituacaoFoto } from '@prisma/client';
import { AcaoAuditoria, AuditoriaService } from '../auditoria/auditoria.service';
import { EscopoAcesso, ehAdmin } from '../auth/escopo';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { SolicitarFotoDto, TAMANHO_MAXIMO_BYTES } from './dto/solicitar-foto.dto';

// createSignedUploadUrl do Supabase tem TTL fixo de 2 h, diferente da URL de leitura.
const MINUTOS_VALIDADE_ENVIO = 120;

const EXTENSAO_POR_TIPO_MIDIA: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

@Injectable()
export class FotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * Idempotente pelo próprio id da foto (gerado no cliente): repetir a solicitação só renova
   * o link de envio. A Idempotency-Key é registrada para acusar reuso com conteúdo diferente.
   */
  async solicitarEnvio(dto: SolicitarFotoDto, escopo: EscopoAcesso, chave: string) {
    const ctx = { usuarioId: escopo.usuarioId, chave, operacao: 'POST /fotos', conteudo: dto };
    const extensao = EXTENSAO_POR_TIPO_MIDIA[dto.tipoMidia];
    const caminhoArmazenamento = `admissao/${dto.id}.${extensao}`;
    const expiraEm = new Date(Date.now() + MINUTOS_VALIDADE_ENVIO * 60 * 1000);

    const { resultado } = await this.idempotencia.executar(ctx, async (tx) => {
      await this.bloquearFoto(tx, dto.id);
      const existente = await tx.foto.findUnique({ where: { id: dto.id } });
      if (existente) this.garantirAutor(existente.criadoPorId, escopo);
      if (existente?.situacao === SituacaoFoto.CONFIRMADA) {
        throw new ConflictException('Foto já confirmada; gere um novo id para enviar outra foto');
      }
      if (await tx.remocaoArquivo.findFirst({ where: { fotoId: dto.id } })) {
        throw new ConflictException(
          'Foto expirada em remoção; gere um novo id para enviar outra foto',
        );
      }
      const dados = {
        tipoMidia: dto.tipoMidia,
        tamanhoBytes: dto.tamanhoBytes,
        caminhoArmazenamento,
        expiraEm,
      };
      const foto = existente
        ? await tx.foto.update({ where: { id: dto.id }, data: dados })
        : await tx.foto.create({
            data: {
              id: dto.id,
              ...dados,
              situacao: SituacaoFoto.PENDENTE,
              criadoPorId: escopo.usuarioId,
            },
          });
      return { recursoId: dto.id, resultado: foto };
    });

    // Storage fica fora da transação. Se falhar, a foto/chave já permitem repetir
    // a mesma solicitação com segurança e obter uma nova URL, sem duplicar a foto.
    const foto =
      resultado ??
      (await this.prisma.$transaction(async (tx) => {
        await this.bloquearFoto(tx, dto.id);
        const atual = await tx.foto.findUnique({ where: { id: dto.id } });
        if (!atual)
          throw new ConflictException('Foto expirada; gere um novo id para enviar outra foto');
        this.garantirAutor(atual.criadoPorId, escopo);
        if (atual.situacao === SituacaoFoto.CONFIRMADA) {
          throw new ConflictException('Foto já confirmada; gere um novo id para enviar outra foto');
        }
        return tx.foto.update({ where: { id: dto.id }, data: { expiraEm } });
      }));
    if (!foto) throw new ConflictException('Foto expirada; gere um novo id para enviar outra foto');
    this.garantirAutor(foto.criadoPorId, escopo);
    if (foto.situacao === SituacaoFoto.CONFIRMADA) {
      throw new ConflictException('Foto já confirmada; gere um novo id para enviar outra foto');
    }
    const { urlEnvio } = await this.storage.criarUrlEnvio(foto.caminhoArmazenamento);
    return { id: dto.id, urlEnvio, expiraEm: expiraEm.toISOString() };
  }

  /** Idempotente pelo estado: confirmar de novo uma foto confirmada devolve o mesmo resultado. */
  async confirmar(id: string, escopo: EscopoAcesso, chave: string) {
    const ctx = {
      usuarioId: escopo.usuarioId,
      chave,
      operacao: `POST /fotos/${id}/confirmacao`,
      conteudo: null,
    };
    // Recusar chave conflitante antes até de remover um arquivo inválido.
    await this.idempotencia.verificarReenvio(ctx);
    const foto = await this.prisma.foto.findUnique({ where: { id } });
    if (!foto) throw new NotFoundException('Foto não encontrada');
    this.garantirAutor(foto.criadoPorId, escopo);

    if (foto.situacao !== SituacaoFoto.CONFIRMADA) {
      this.garantirPrazoEnvio(foto.expiraEm);
      const metadados = await this.storage.obterMetadados(foto.caminhoArmazenamento);
      if (!metadados) throw new ConflictException('Arquivo ainda não foi enviado ao armazenamento');
      if (metadados.tamanhoBytes !== null && metadados.tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
        throw new BadRequestException('Arquivo excede o tamanho máximo de 8 MB');
      }
      if (metadados.tipoMidia !== null && metadados.tipoMidia !== foto.tipoMidia) {
        throw new BadRequestException('Tipo do arquivo enviado difere do informado na solicitação');
      }
    }

    await this.idempotencia.executar(ctx, async (tx) => {
      await this.bloquearFoto(tx, id);
      const atual = await tx.foto.findUnique({ where: { id } });
      if (!atual) throw new NotFoundException('Foto não encontrada');
      this.garantirAutor(atual.criadoPorId, escopo);
      if (atual.situacao === SituacaoFoto.CONFIRMADA) {
        return { recursoId: id, resultado: null };
      }
      this.garantirPrazoEnvio(atual.expiraEm);
      if (
        atual.caminhoArmazenamento !== foto.caminhoArmazenamento ||
        atual.tipoMidia !== foto.tipoMidia
      ) {
        throw new ConflictException(
          'Solicitação da foto foi alterada; confirme o arquivo atual novamente',
        );
      }
      await tx.foto.update({ where: { id }, data: { situacao: SituacaoFoto.CONFIRMADA } });
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.FOTO_CONFIRMADA,
        entidade: 'Foto',
        entidadeId: foto.id,
      });
      return { recursoId: id, resultado: null };
    });

    return { id: foto.id, situacao: SituacaoFoto.CONFIRMADA };
  }

  private garantirPrazoEnvio(expiraEm: Date) {
    if (expiraEm.getTime() <= Date.now()) {
      throw new ConflictException(
        'Prazo de envio expirado; solicite uma nova URL antes de confirmar a foto',
      );
    }
  }

  /** Serializa operações do mesmo ID, inclusive quando a foto ainda não existe. */
  private async bloquearFoto(tx: Prisma.TransactionClient, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
  }

  /** Foto ainda sem animal não tem unidade: o controle é por autoria (ou admin). */
  private garantirAutor(criadoPorId: string | null, escopo: EscopoAcesso) {
    if (criadoPorId !== escopo.usuarioId && !ehAdmin(escopo)) {
      throw new ForbiddenException('Foto enviada por outro usuário');
    }
  }
}
