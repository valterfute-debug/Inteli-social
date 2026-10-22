import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Decisão da equipe: acabou a divisão ADMIN/OPERADOR e o escopo por unidade. Toda conta ativa faz
 * as mesmas operações, em qualquer unidade. O que continua: login válido + conta liberada e
 * ativa, e a regra de autoria das fotos ainda sem ficha. Dados fictícios.
 */
describe('Acesso igual para toda conta ativa (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let ana: UsuarioTeste;
  let beto: UsuarioTeste;
  let semLiberacao: UsuarioTeste;
  let desativado: UsuarioTeste;
  let unidadeCasAdote: string;
  let unidadeCed: string;
  let catalogo: { especieId: string; responsavelId: string };
  let animalId: string;

  const http = () => request(ambiente.app.getHttpServer());

  /** Solicita e confirma uma foto em nome de `quem`, devolvendo o id. */
  async function fotoConfirmada(quem: UsuarioTeste) {
    const id = randomUUID();
    await http()
      .post('/api/v1/fotos')
      .set('Authorization', quem.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({ id, tipoMidia: 'image/jpeg', tamanhoBytes: 1000 })
      .expect(201);
    await http()
      .post(`/api/v1/fotos/${id}/confirmacao`)
      .set('Authorization', quem.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .expect(200);
    return id;
  }

  function admissaoCasAdote(fotoEntradaId: string, extra: Record<string, unknown> = {}) {
    return {
      nome: 'Luna',
      especieId: catalogo.especieId,
      responsavelId: catalogo.responsavelId,
      frente: 'CASADOTE',
      fotoEntradaId,
      ...extra,
    };
  }

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    unidadeCasAdote = await ambiente.idUnidade('CasAdote');
    unidadeCed = await ambiente.idUnidade('CED');
    const { prisma } = ambiente;
    catalogo = {
      especieId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
      responsavelId: (await prisma.responsible.findFirstOrThrow()).id,
    };

    ana = await ambiente.usuario('ana');
    beto = await ambiente.usuario('beto');
    semLiberacao = await ambiente.usuario('sem-liberacao', 'nao-liberado');
    desativado = await ambiente.usuario('desativado', 'desativado');
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  describe('contas', () => {
    it('sem token: 401', async () => {
      await http().get('/api/v1/animals').expect(401);
    });

    it.each([
      ['sem liberação na API', () => semLiberacao],
      ['desativada', () => desativado],
    ])('recusa conta %s com 403 mesmo com login válido', async (_caso, quem) => {
      await http().get('/api/v1/animals').set('Authorization', quem().autorizacao).expect(403);
    });

    it('/me devolve só os dados da conta: sem papel e sem unidades', async () => {
      const resposta = await http()
        .get('/api/v1/me')
        .set('Authorization', ana.autorizacao)
        .expect(200);

      expect(resposta.body).toEqual({ id: 'ana', email: 'ana@teste.invalid', nome: null });
    });

    it('o banco não guarda mais papel nem vínculo conta × unidade', async () => {
      const colunas = await ambiente.prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'Usuario'`;
      expect(colunas.map((c) => c.column_name)).not.toContain('papel');

      const tabelas = await ambiente.prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      expect(tabelas.map((t) => t.tablename)).not.toContain('UsuarioUnidade');

      const tipos = await ambiente.prisma.$queryRaw<{ typname: string }[]>`
        SELECT typname FROM pg_type WHERE typname = 'PapelUsuario'`;
      expect(tipos).toHaveLength(0);
    });
  });

  describe('catálogos', () => {
    it('toda conta vê todas as unidades e as localizações de qualquer unidade', async () => {
      const unidades = await http().get('/api/v1/units').set('Authorization', beto.autorizacao);
      const nomes = unidades.body.itens.map((u: { nome: string }) => u.nome);
      expect(nomes).toEqual(expect.arrayContaining(['CCPA', 'CED', 'CasAdote']));

      await http()
        .get(`/api/v1/locations?unidadeId=${unidadeCed}`)
        .set('Authorization', ana.autorizacao)
        .expect(200);
    });
  });

  describe('fotos (ainda sem animal: controle por autoria, igual para todos)', () => {
    it('outra conta não confirma nem reaproveita o id da foto alheia', async () => {
      const id = randomUUID();
      await http()
        .post('/api/v1/fotos')
        .set('Authorization', ana.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ id, tipoMidia: 'image/jpeg', tamanhoBytes: 1000 })
        .expect(201);

      await http()
        .post(`/api/v1/fotos/${id}/confirmacao`)
        .set('Authorization', beto.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .expect(403);
      await http()
        .post('/api/v1/fotos')
        .set('Authorization', beto.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ id, tipoMidia: 'image/png', tamanhoBytes: 2000 })
        .expect(403);
    });

    it('não permite vincular à ficha uma foto enviada por outra conta', async () => {
      const fotoAlheia = await fotoConfirmada(ana);
      const resposta = await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', beto.autorizacao)
        .send(admissaoCasAdote(fotoAlheia))
        .expect(403);
      expect(resposta.body.mensagem).toBe('Foto enviada por outro usuário');
    });
  });

  describe('animais: qualquer conta faz o mesmo trabalho em qualquer unidade', () => {
    it('Ana cadastra; Beto lista e consulta, inclusive a foto', async () => {
      const foto = await fotoConfirmada(ana);
      const criado = await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', ana.autorizacao)
        .send(admissaoCasAdote(foto))
        .expect(201);
      animalId = criado.body.id;
      expect(criado.body.unidadeNome).toBe('CasAdote');

      const lista = await http().get('/api/v1/animals').set('Authorization', beto.autorizacao);
      expect(lista.body.itens.map((a: { id: string }) => a.id)).toContain(animalId);

      const ficha = await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', beto.autorizacao)
        .expect(200);
      expect(ficha.body.fotoEntradaUrl).toContain('storage.invalid/leitura');
    });

    it('cadastra em qualquer unidade, inclusive informando outra', async () => {
      const foto = await fotoConfirmada(beto);
      const resposta = await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', beto.autorizacao)
        .send(admissaoCasAdote(foto, { unidadeId: unidadeCed }))
        .expect(201);
      expect(resposta.body.unidadeNome).toBe('CED');
    });

    it('Beto edita e transfere o animal de Ana; Ana continua vendo e editando', async () => {
      const transferido = await http()
        .patch(`/api/v1/animals/${animalId}`)
        .set('Authorization', beto.autorizacao)
        .send({ versao: 1, unidadeId: unidadeCed, cor: 'Preta' })
        .expect(200);
      expect(transferido.body).toMatchObject({ unidadeNome: 'CED', cor: 'Preta', versao: 2 });

      const lidoPorAna = await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', ana.autorizacao)
        .expect(200);
      expect(lidoPorAna.body.unidadeNome).toBe('CED');

      await http()
        .patch(`/api/v1/animals/${animalId}`)
        .set('Authorization', ana.autorizacao)
        .send({ versao: 2, unidadeId: unidadeCasAdote })
        .expect(200);
    });
  });

  describe('saúde, prontuário e auditoria', () => {
    it('evento de saúde e atendimento por uma conta, consultados pela outra', async () => {
      await http()
        .post(`/api/v1/animals/${animalId}/health-events`)
        .set('Authorization', ana.autorizacao)
        .send({ tipo: 'VACINA', descricao: 'V10', data: '2026-10-01' })
        .expect(201);
      await http()
        .post(`/api/v1/animals/${animalId}/atendimentos`)
        .set('Authorization', beto.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'Admissão' })
        .expect(201);

      const eventos = await http()
        .get(`/api/v1/animals/${animalId}/health-events`)
        .set('Authorization', beto.autorizacao)
        .expect(200);
      expect(eventos.body.total).toBe(1);
      const atendimentos = await http()
        .get(`/api/v1/animals/${animalId}/atendimentos`)
        .set('Authorization', ana.autorizacao)
        .expect(200);
      expect(atendimentos.body.total).toBe(1);
    });

    it('prontuário em PDF para qualquer conta', async () => {
      for (const quem of [ana, beto]) {
        const pdf = await http()
          .get(`/api/v1/animals/${animalId}/prontuario`)
          .set('Authorization', quem.autorizacao)
          .expect(200);
        expect(pdf.headers['content-type']).toContain('application/pdf');
      }
    });

    it('qualquer conta ativa consulta a auditoria', async () => {
      const resposta = await http()
        .get(`/api/v1/auditoria?entidade=Animal&entidadeId=${animalId}`)
        .set('Authorization', beto.autorizacao)
        .expect(200);
      expect(resposta.body.total).toBeGreaterThan(0);
    });

    it('responsáveis: toda conta vê o contato e edita qualquer um', async () => {
      const criado = await http()
        .post('/api/v1/responsibles')
        .set('Authorization', ana.autorizacao)
        .send({
          nome: 'Maria Fictícia',
          email: 'maria@exemplo.invalid',
          telefone: '(11) 90000-0000',
        })
        .expect(201);

      const lista = await http().get('/api/v1/responsibles').set('Authorization', beto.autorizacao);
      expect(lista.body.itens.find((r: { id: string }) => r.id === criado.body.id)).toMatchObject({
        email: 'maria@exemplo.invalid',
        telefone: '(11) 90000-0000',
      });
      await http()
        .patch(`/api/v1/responsibles/${criado.body.id}`)
        .set('Authorization', beto.autorizacao)
        .send({ endereco: 'Rua Nova, 20' })
        .expect(200);
    });
  });

  describe('arquivamento', () => {
    it('qualquer conta arquiva', async () => {
      await http()
        .delete(`/api/v1/animals/${animalId}`)
        .set('Authorization', beto.autorizacao)
        .expect(204);
    });
  });
});
