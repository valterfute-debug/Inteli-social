import { ConfigService } from '@nestjs/config';
import {
  SEGUNDOS_VALIDADE_LEITURA_PADRAO,
  SupabaseStorageService,
} from './supabase-storage.service';

const getBucket = jest.fn();
const createSignedUrls = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ storage: { getBucket, from: () => ({ createSignedUrls }) } }),
}));

function configCom(valores: Record<string, unknown>) {
  return { get: (chave: string) => valores[chave] } as unknown as ConfigService;
}

const CONFIGURADO = {
  SUPABASE_URL: 'https://projeto-teste.supabase.invalid',
  SUPABASE_SERVICE_ROLE_KEY: 'chave-de-teste',
};

describe('SupabaseStorageService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('usa 15 minutos de validade por padrão e respeita FOTO_URL_VALIDADE_SEGUNDOS', async () => {
    createSignedUrls.mockResolvedValue({ data: [], error: null });

    await new SupabaseStorageService(configCom(CONFIGURADO)).criarUrlsLeitura(['a.jpg']);
    expect(createSignedUrls).toHaveBeenLastCalledWith(['a.jpg'], SEGUNDOS_VALIDADE_LEITURA_PADRAO);

    await new SupabaseStorageService(
      configCom({ ...CONFIGURADO, FOTO_URL_VALIDADE_SEGUNDOS: 300 }),
    ).criarUrlsLeitura(['a.jpg']);
    expect(createSignedUrls).toHaveBeenLastCalledWith(['a.jpg'], 300);
  });

  it.each([
    [false, 'privado'],
    [true, 'publico'],
  ])('bucket com public=%p é reportado como %s', async (publico, esperado) => {
    getBucket.mockResolvedValue({ data: { public: publico }, error: null });
    await expect(new SupabaseStorageService(configCom(CONFIGURADO)).situacaoBucket()).resolves.toBe(
      esperado,
    );
  });

  it('sem credenciais informa "nao_configurado" sem chamar o Supabase', async () => {
    await expect(new SupabaseStorageService(configCom({})).situacaoBucket()).resolves.toBe(
      'nao_configurado',
    );
    expect(getBucket).not.toHaveBeenCalled();
  });

  it('erro do Supabase ao consultar o bucket vira exceção (readiness responde 503)', async () => {
    getBucket.mockResolvedValue({ data: null, error: { message: 'not found' } });
    await expect(
      new SupabaseStorageService(configCom(CONFIGURADO)).situacaoBucket(),
    ).rejects.toThrow('Falha ao consultar o bucket de fotos');
  });
});
