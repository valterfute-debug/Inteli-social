import { Controller, Get, HttpException, INestApplication, VERSION_NEUTRAL } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configurarAplicacao } from '../src/configurar-aplicacao';

@Controller({ path: 'teste-erros', version: VERSION_NEUTRAL })
class ErrosDeTeste {
  @Get('400') entrada() {
    throw new HttpException({ message: ['Campo inválido'] }, 400);
  }
  @Get('401') sessao() {
    throw new HttpException('Sessão necessária', 401);
  }
  @Get('403') acesso() {
    throw new HttpException('Acesso negado', 403);
  }
  @Get('409') conflito() {
    throw new HttpException('Versão desatualizada', 409);
  }
  @Get('500') interno() {
    throw new Error('senha=segredo SQL SELECT');
  }
}

describe('Aplicação NestJS via HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ErrosDeTeste],
    }).compile();
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
  it.each([400, 401, 403, 409, 500])('preserva status %i e padroniza o erro', async (status) => {
    const caminho = '/api/teste-erros/' + status;
    const resposta = await request(app.getHttpServer())
      .get(caminho + '?token=segredo')
      .expect(status);
    expect(Object.keys(resposta.body).sort()).toEqual([
      'caminho',
      'mensagem',
      'statusCode',
      'timestamp',
    ]);
    expect(resposta.body.caminho).toBe(caminho);
    expect(resposta.body.statusCode).toBe(status);
    expect(Number.isNaN(Date.parse(resposta.body.timestamp))).toBe(false);
    expect(JSON.stringify(resposta.body)).not.toContain('segredo');

    if (status === 400) {
      expect(resposta.body.mensagem).toEqual(['Campo inválido']);
    }
    if (status === 409) {
      expect(resposta.body.mensagem).toBe('Versão desatualizada');
    }
    if (status === 500) {
      expect(resposta.body.mensagem).toBe('Erro interno do servidor');
    }
  });

  it('retorna 404 para rota inexistente e saúde versionada', async () => {
    for (const caminho of ['/api/inexistente', '/api/v1/health']) {
      const resposta = await request(app.getHttpServer()).get(caminho).expect(404);
      expect(resposta.body.mensagem).toBe('Recurso não encontrado');
    }
  });
});
