import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SituacaoFoto } from '@prisma/client';
import { EscopoAcesso, ehAdmin } from '../auth/escopo';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { SolicitarFotoDto, TAMANHO_MAXIMO_BYTES } from './dto/solicitar-foto.dto';

const MINUTOS_VALIDADE_ENVIO = 15;

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
  ) {}

  /**
   * Idempotente pelo próprio id da foto (gerado no cliente): repetir a solicitação só renova
   * o link de envio. A Idempotency-Key é registrada para acusar reuso com conteúdo diferente.
   */
  async solicitarEnvio(dto: SolicitarFotoDto, escopo: EscopoAcesso, chave: string) {
    const ctx = { usuarioId: escopo.usuarioId, chave, operacao: 'POST /fotos', conteudo: dto };
    await this.idempotencia.verificarReenvio(ctx);

    const extensao = EXTENSAO_POR_TIPO_MIDIA[dto.tipoMidia];
    const caminhoArmazenamento = `admissao/${dto.id}.${extensao}`;
    const expiraEm = new Date(Date.now() + MINUTOS_VALIDADE_ENVIO * 60 * 1000);

    const existente = await this.prisma.foto.findUnique({ where: { id: dto.id } });
    // O id vem do cliente: sem isto, quem soubesse o id de uma foto pendente alheia
    // poderia trocar o arquivo dela.
    if (existente) this.garantirAutor(existente.criadoPorId, escopo);
    // Uma foto confirmada pode já estar vinculada a um animal: reescrever caminho/tipo
    // faria a ficha apontar para um arquivo que não existe. Nova foto = novo id.
    if (existente?.situacao === SituacaoFoto.CONFIRMADA) {
      throw new ConflictException('Foto já confirmada; gere um novo id para enviar outra foto');
    }

    const { urlEnvio } = await this.storage.criarUrlEnvio(caminhoArmazenamento);

    await this.prisma.foto.upsert({
      where: { id: dto.id },
      create: {
        id: dto.id,
        tipoMidia: dto.tipoMidia,
        tamanhoBytes: dto.tamanhoBytes,
        caminhoArmazenamento,
        situacao: SituacaoFoto.PENDENTE,
        expiraEm,
        criadoPorId: escopo.usuarioId,
      },
      update: {
        tipoMidia: dto.tipoMidia,
        tamanhoBytes: dto.tamanhoBytes,
        caminhoArmazenamento,
        expiraEm,
      },
    });
    await this.idempotencia.registrar(ctx, dto.id);

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
    await this.idempotencia.verificarReenvio(ctx);

    const foto = await this.prisma.foto.findUnique({ where: { id } });
    if (!foto) throw new NotFoundException('Foto não encontrada');
    this.garantirAutor(foto.criadoPorId, escopo);

    if (foto.situacao === SituacaoFoto.CONFIRMADA) {
      await this.idempotencia.registrar(ctx, foto.id);
      return { id: foto.id, situacao: SituacaoFoto.CONFIRMADA };
    }

    const metadados = await this.storage.obterMetadados(foto.caminhoArmazenamento);
    if (!metadados) {
      throw new ConflictException('Arquivo ainda não foi enviado ao armazenamento');
    }
    // O tamanho declarado em POST /fotos é do cliente; aqui vale o arquivo real.
    if (metadados.tamanhoBytes !== null && metadados.tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
      await this.storage.removerArquivo(foto.caminhoArmazenamento);
      throw new BadRequestException('Arquivo excede o tamanho máximo de 8 MB');
    }
    if (metadados.tipoMidia !== null && metadados.tipoMidia !== foto.tipoMidia) {
      await this.storage.removerArquivo(foto.caminhoArmazenamento);
      throw new BadRequestException('Tipo do arquivo enviado difere do informado na solicitação');
    }

    await this.prisma.foto.update({
      where: { id },
      data: { situacao: SituacaoFoto.CONFIRMADA },
    });
    await this.idempotencia.registrar(ctx, foto.id);

    return { id: foto.id, situacao: SituacaoFoto.CONFIRMADA };
  }

  /** Foto ainda sem animal não tem unidade: o controle é por autoria (ou admin). */
  private garantirAutor(criadoPorId: string | null, escopo: EscopoAcesso) {
    if (criadoPorId !== escopo.usuarioId && !ehAdmin(escopo)) {
      throw new ForbiddenException('Foto enviada por outro usuário');
    }
  }
}
