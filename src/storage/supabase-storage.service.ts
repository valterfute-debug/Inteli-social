import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient, createClient } from '@supabase/supabase-js';

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

  async arquivoExiste(caminho: string): Promise<boolean> {
    const ultimaBarra = caminho.lastIndexOf('/');
    const pasta = ultimaBarra >= 0 ? caminho.slice(0, ultimaBarra) : '';
    const nomeArquivo = ultimaBarra >= 0 ? caminho.slice(ultimaBarra + 1) : caminho;

    const { data, error } = await this.obterCliente()
      .storage.from(this.obterBucket())
      .list(pasta, { search: nomeArquivo });
    if (error) {
      throw new InternalServerErrorException('Falha ao verificar o envio da foto');
    }
    return (data ?? []).some((item) => item.name === nomeArquivo);
  }
}
