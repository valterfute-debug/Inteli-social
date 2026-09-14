import { ArgumentsHost, HttpException, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// supertest exporta uma função CommonJS; esta sintaxe evita dependência de esModuleInterop no editor.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { FiltroExcecaoGlobal } from '../src/common/filtros/filtro-excecao-global';
import { configurarAplicacao } from '../src/configurar-aplicacao';

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
