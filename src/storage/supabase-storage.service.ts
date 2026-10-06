import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

/** Validade das URLs de leitura: cobre uma sessão de consulta sem ficar pública por muito tempo. */
const SEGUNDOS_VALIDADE_LEITURA = 60 * 60;

@Injectable()
export class SupabaseStorageService {
  private cliente: SupabaseClient | null = null;

  constructor(private readonly config: ConfigService) {}

  private obterCliente(): SupabaseClient {
    if (this.cliente) return this.cliente;

    const url = this.config.get<string>('SUPABASE_URL');
    const chave = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !chave) {
      throw new InternalServerErrorException(
        'Armazenamento de fotos não configurado (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes)',
      );
    }

    this.cliente = createClient(url, chave, { auth: { persistSession: false } });
    return this.cliente;
  }

  private obterBucket(): string {
    return this.config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'fotos-animais';
  }

  async criarUrlEnvio(caminho: string): Promise<{ urlEnvio: string }> {
    const { data, error } = await this.obterCliente()
      .storage.from(this.obterBucket())
      .createSignedUploadUrl(caminho);
    if (error || !data) {
      throw new InternalServerErrorException('Falha ao preparar o envio da foto');
    }
    return { urlEnvio: data.signedUrl };
  }

  /**
   * Metadados do arquivo já enviado, ou null se ele ainda não chegou ao bucket.
   * Usado na confirmação para conferir tamanho e tipo reais, não os declarados pelo cliente.
   */
  async obterMetadados(
    caminho: string,
  ): Promise<{ tamanhoBytes: number | null; tipoMidia: string | null } | null> {
    const ultimaBarra = caminho.lastIndexOf('/');
    const pasta = ultimaBarra >= 0 ? caminho.slice(0, ultimaBarra) : '';
    const nomeArquivo = ultimaBarra >= 0 ? caminho.slice(ultimaBarra + 1) : caminho;

    const { data, error } = await this.obterCliente()
      .storage.from(this.obterBucket())
      .list(pasta, { search: nomeArquivo });
    if (error) {
      throw new InternalServerErrorException('Falha ao verificar o envio da foto');
    }
    const item = (data ?? []).find((arquivo) => arquivo.name === nomeArquivo);
    if (!item) return null;
    const metadados = (item.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
    return {
      tamanhoBytes: typeof metadados.size === 'number' ? metadados.size : null,
      tipoMidia: typeof metadados.mimetype === 'string' ? metadados.mimetype : null,
    };
  }

  async removerArquivo(caminho: string): Promise<void> {
    await this.obterCliente().storage.from(this.obterBucket()).remove([caminho]);
  }

  /**
   * URLs assinadas de leitura, em lote (uma única chamada ao Storage por página da listagem).
   * Devolve um mapa caminho → URL; caminhos sem URL ficam de fora.
   */
  async criarUrlsLeitura(caminhos: string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (caminhos.length === 0) return urls;
    const { data, error } = await this.obterCliente()
      .storage.from(this.obterBucket())
      .createSignedUrls(caminhos, SEGUNDOS_VALIDADE_LEITURA);
    if (error || !data) {
      throw new InternalServerErrorException('Falha ao gerar URLs de leitura das fotos');
    }
    for (const item of data) {
      if (item.path && item.signedUrl && !item.error) urls.set(item.path, item.signedUrl);
    }
    return urls;
  }
}
