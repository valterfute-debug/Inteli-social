import { ArgumentsHost, HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// supertest exporta uma função CommonJS; esta sintaxe evita dependência de esModuleInterop no editor.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { CHAVES_JWT } from '../src/auth/verificador-token.service';
import { FiltroExcecaoGlobal } from '../src/common/filtros/filtro-excecao-global';
import { configurarAplicacao, resolverOrigensCors } from '../src/configurar-aplicacao';
import { criarEmissorDeTokens } from './tokens-teste';

/** Sobe a aplicação inteira com as chaves do Supabase Auth trocadas por chaves locais. */
async function criarAppComAutenticacao() {
  const emissor = await criarEmissorDeTokens();
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CHAVES_JWT)
    .useValue(emissor.chaves)
    .compile();
  const app = modulo.createNestApplication();
  configurarAplicacao(app);
  await app.init();
  return { app, emissor };
}

describe('Aplicação NestJS via HTTP', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication();
    configurarAplicacao(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('responde saúde sem consultar banco', async () => {
    const resposta = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(resposta.body.status).toBe('ok');
    expect(Number.isNaN(Date.parse(resposta.body.timestamp))).toBe(false);
  });
});

describe('Filtro global de exceções', () => {
  function executarFiltro(exception: unknown, caminho = '/api/teste-erros') {
    const resposta = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    const host = {
      switchToHttp: () => ({
        getResponse: () => resposta,
        getRequest: () => ({ path: caminho }),
      }),
    } as unknown as ArgumentsHost;

    new FiltroExcecaoGlobal().catch(exception, host);
    return resposta;
  }

  it.each([
    [400, ['Campo inválido']],
    [401, 'Sessão necessária'],
    [403, 'Acesso negado'],
    [409, 'Versão desatualizada'],
  ])('preserva status HTTP %i e padroniza o corpo', (status, mensagem) => {
    const resposta = executarFiltro(new HttpException({ message: mensagem }, status));

    expect(resposta.status).toHaveBeenCalledWith(status);
    expect(resposta.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: status,
        mensagem,
        caminho: '/api/teste-erros',
        timestamp: expect.any(String),
      }),
    );
  });

  it('oculta detalhes internos em erro 500', () => {
    const resposta = executarFiltro(new Error('senha=segredo SQL SELECT'), '/api/falha');

    expect(resposta.status).toHaveBeenCalledWith(500);
    expect(resposta.json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        mensagem: 'Erro interno do servidor',
        caminho: '/api/falha',
      }),
    );
    expect(JSON.stringify(resposta.json.mock.calls)).not.toContain('segredo');
  });
});

describe('Autenticação via HTTP', () => {
  let app: INestApplication;
  let emissor: Awaited<ReturnType<typeof criarEmissorDeTokens>>;

  beforeAll(async () => {
    ({ app, emissor } = await criarAppComAutenticacao());
  });
  afterAll(async () => {
    await app.close();
  });

  it.each(['/api/health', '/api/health/ready'])('mantém %s público (health check do Render)', async (rota) => {
    const resposta = await request(app.getHttpServer()).get(rota);
    expect(resposta.status).not.toBe(401);
  });

  it.each([
    ['get', '/api/v1/animals'],
    ['get', '/api/v1/fronts'],
    ['post', '/api/v1/animals'],
    ['post', '/api/v1/fotos'],
    ['delete', '/api/v1/animals/6f1c2d3e-4b5a-4c6d-8e7f-90a1b2c3d4e5'],
  ] as const)('recusa %s %s sem token com 401', async (metodo, rota) => {
    const resposta = await request(app.getHttpServer())[metodo](rota).expect(401);
    expect(resposta.body.mensagem).toBe('Autenticação necessária');
  });

  it('recusa token inválido com 401', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/v1/fronts')
      .set('Authorization', 'Bearer nao-e-um-token')
      .expect(401);
    expect(resposta.body.mensagem).toBe('Token inválido ou expirado');
  });

  it('aceita token válido', async () => {
    const token = await emissor.assinar();
    await request(app.getHttpServer())
      .get('/api/v1/fronts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

describe('Hardening HTTP', () => {
  let app: INestApplication;
  let autorizacao: string;

  beforeAll(async () => {
    const criado = await criarAppComAutenticacao();
    app = criado.app;
    autorizacao = `Bearer ${await criado.emissor.assinar()}`;
  });
  afterAll(async () => {
    await app.close();
  });

  it('envia cabeçalhos de segurança e não revela o framework', async () => {
    const resposta = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(resposta.headers['x-content-type-options']).toBe('nosniff');
    expect(resposta.headers['x-powered-by']).toBeUndefined();
  });

  it('rejeita microchip com letras na busca antes de consultar o banco', async () => {
    const resposta = await request(app.getHttpServer())
      .get('/api/v1/animals?microchip=12AB')
      .set('Authorization', autorizacao)
      .expect(400);
    expect(JSON.stringify(resposta.body.mensagem)).toContain('microchip');
  });

  it('rejeita parâmetros de consulta desconhecidos', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/animals?admin=true')
      .set('Authorization', autorizacao)
      .expect(400);
  });

  it('rejeita peso acima do suportado pelo banco com 400, não 500', async () => {
    const resposta = await request(app.getHttpServer())
      .post('/api/v1/animals')
      .set('Authorization', autorizacao)
      .send({ pesoKg: 100000 })
      .expect(400);
    expect(JSON.stringify(resposta.body.mensagem)).toContain('pesoKg');
  });
});

describe('Origens CORS', () => {
  it('usa a lista configurada, ignorando espaços', () => {
    expect(resolverOrigensCors('production', 'https://a.app, https://b.app')).toEqual([
      'https://a.app',
      'https://b.app',
    ]);
  });

  it('em produção sem configuração bloqueia navegadores (falha fechada)', () => {
    expect(resolverOrigensCors('production', undefined)).toBe(false);
  });

  it('em desenvolvimento sem configuração libera qualquer origem', () => {
    expect(resolverOrigensCors('development', '')).toBe(true);
  });
});
