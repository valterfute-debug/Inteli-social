import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CHAVES_JWT } from '../src/auth/verificador-token.service';
import { configurarAplicacao } from '../src/configurar-aplicacao';
import { criarEmissorDeTokens } from './tokens-teste';

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
describe('Gestão de equipe via HTTP', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  const rows = new Map([
    [
      a,
      {
        id: a,
        nome: 'Pessoa A',
        email: 'a@example.test',
        ativo: true,
        gerenciaEquipe: true,
        administradorMaster: false,
        redefinicaoEmAndamento: false,
      },
    ],
    [
      b,
      {
        id: b,
        nome: 'Pessoa B',
        email: 'b@example.test',
        ativo: true,
        gerenciaEquipe: false,
        administradorMaster: false,
        redefinicaoEmAndamento: false,
      },
    ],
  ]);
  beforeAll(async () => {
    const emissor = await criarEmissorDeTokens();
    tokenA = await emissor.assinar({ sub: a });
    tokenB = await emissor.assinar({ sub: b });
    const users = {
      findUnique: async ({ where }: { where: { id: string } }) => rows.get(where.id) ?? null,
      findMany: async () => [...rows.values()],
      update: async ({ where, data }: { where: { id: string }; data: { ativo: boolean } }) => {
        const row = rows.get(where.id)!;
        row.ativo = data.ativo;
        return { id: row.id, ativo: row.ativo };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          id: string;
          ativo?: boolean;
          gerenciaEquipe?: boolean;
          administradorMaster?: boolean;
          redefinicaoEmAndamento?: boolean;
        };
        data: { ativo?: boolean; gerenciaEquipe?: boolean };
      }) => {
        const row = rows.get(where.id);
        if (
          !row ||
          Object.entries(where).some(([key, value]) => row[key as keyof typeof row] !== value)
        )
          return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    };
    const prisma = {
      usuario: users,
      eventoAuditoria: { create: async () => ({}) },
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({ usuario: users, eventoAuditoria: { create: async () => ({}) } }),
      $disconnect: async () => undefined,
    };
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(CHAVES_JWT)
      .useValue(emissor.chaves)
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = modulo.createNestApplication();
    configurarAplicacao(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  it('exige administrador em todas as rotas de gestão', async () => {
    await request(app.getHttpServer()).get('/api/v1/equipe').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/equipe/contas')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ email: 'pessoa@example.test' })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/equipe/convites-qr')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
    await request(app.getHttpServer())
      .post(`/api/v1/equipe/${a}/redefinir-senha`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${a}/acesso`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ ativo: false })
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.gerenciaEquipe).toBe(false);
      });
  });
  it('valida o formato do convite público sem exigir login', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/convites-qr/aceitar')
      .send({ token: 'inválido', email: 'pessoa@example.test', senha: 'senha-segura' })
      .expect(400);
  });
  it('reserva promoção e remoção da permissão para o master', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${a}/administracao`)
      .send({ administrador: true })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${a}/administracao`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ administrador: true })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/administracao`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ administrador: true })
      .expect(403);
    rows.get(a)!.administradorMaster = true;
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/administracao`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ administrador: true })
      .expect(200);
    expect(rows.get(b)!.gerenciaEquipe).toBe(true);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${a}/acesso`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ ativo: false })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${a}/administracao`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ administrador: false })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/administracao`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ administrador: false })
      .expect(200);
    rows.get(a)!.administradorMaster = false;
  });
  it('valida o corpo, desativa, bloqueia a conta imediatamente e permite reativar', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/acesso`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ativo: 'false' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/acesso`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ativo: false })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/v1/equipe/${b}/acesso`)
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ ativo: true })
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);
  });
  it('revoga acesso de gestão imediatamente ao mudar a permissão no servidor', async () => {
    rows.get(a)!.gerenciaEquipe = false;
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(403);
    rows.get(a)!.gerenciaEquipe = true;
    await request(app.getHttpServer())
      .get('/api/v1/equipe')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
  });
});
