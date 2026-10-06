import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SituacaoFoto } from '@prisma/client';
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
  ) {}

  async solicitarEnvio(dto: SolicitarFotoDto) {
    const extensao = EXTENSAO_POR_TIPO_MIDIA[dto.tipoMidia];
    const caminhoArmazenamento = `admissao/${dto.id}.${extensao}`;
    const expiraEm = new Date(Date.now() + MINUTOS_VALIDADE_ENVIO * 60 * 1000);

    // Uma foto confirmada pode já estar vinculada a um animal: reescrever caminho/tipo
    // faria a ficha apontar para um arquivo que não existe. Nova foto = novo id.
    const existente = await this.prisma.foto.findUnique({ where: { id: dto.id } });
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
      },
      update: {
        tipoMidia: dto.tipoMidia,
        tamanhoBytes: dto.tamanhoBytes,
        caminhoArmazenamento,
        expiraEm,
      },
    });

    return { id: dto.id, urlEnvio, expiraEm: expiraEm.toISOString() };
  }

  async confirmar(id: string) {
    const foto = await this.prisma.foto.findUnique({ where: { id } });
    if (!foto) throw new NotFoundException('Foto não encontrada');

    if (foto.situacao === SituacaoFoto.CONFIRMADA) {
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

    return { id: foto.id, situacao: SituacaoFoto.CONFIRMADA };
  }
}
