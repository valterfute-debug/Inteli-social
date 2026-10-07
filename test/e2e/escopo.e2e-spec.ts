import { randomUUID } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Issue #3, P0-2: o escopo vem da conta no servidor, nunca dos parâmetros da requisição.
 * Cenário: uma operadora do CasAdote, um operador do CED, uma admin, uma conta que fez
 * login no Supabase mas não foi liberada na API e uma conta desativada.
 */
describe('Escopo por unidade (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let admin: UsuarioTeste;
  let opCasAdote: UsuarioTeste;
  let opCed: UsuarioTeste;
  let semLiberacao: UsuarioTeste;
  let desativado: UsuarioTeste;
  let unidadeCasAdote: string;
  let unidadeCed: string;
  let catalogo: { especieId: string; canilId: string; coloniaId: string; responsavelId: string };
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

  function admissaoCasAdote(fotoEntradaId: string, unidadeId = unidadeCasAdote) {
    return {
      nome: 'Luna',
      especieId: catalogo.especieId,
      unidadeId,
      localizacaoId: unidadeId === unidadeCasAdote ? catalogo.canilId : catalogo.coloniaId,
      responsavelId: catalogo.responsavelId,
      frente: 'CASADOTE',
      fotoEntradaId,
    };
  }

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    unidadeCasAdote = await ambiente.idUnidade('CasAdote');
    unidadeCed = await ambiente.idUnidade('CED');
    const { prisma } = ambiente;
    catalogo = {
      especieId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
      canilId: (
        await prisma.location.findUniqueOrThrow({
          where: { unitId_name: { unitId: unidadeCasAdote, name: 'Canil' } },
        })
      ).id,
      coloniaId: (
        await prisma.location.findUniqueOrThrow({
          where: { unitId_name: { unitId: unidadeCed, name: 'Colônia' } },
        })
      ).id,
      responsavelId: (await prisma.responsible.findFirstOrThrow()).id,
    };

    admin = await ambiente.usuario('admin', PapelUsuario.ADMIN);
    opCasAdote = await ambiente.usuario('op-casadote', PapelUsuario.OPERADOR, ['CasAdote']);
    opCed = await ambiente.usuario('op-ced', PapelUsuario.OPERADOR, ['CED']);
    semLiberacao = await ambiente.usuario('sem-liberacao');
    desativado = await ambiente.usuario('desativado', PapelUsuario.ADMIN, [], false);
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  describe('contas', () => {
    it.each([
      ['sem liberação na API', () => semLiberacao],
      ['desativada', () => desativado],
    ])('recusa conta %s com 403 mesmo com login válido', async (_caso, quem) => {
      await http().get('/api/v1/animals').set('Authorization', quem().autorizacao).expect(403);
    });

    it('/me devolve papel e só as unidades da operadora', async () => {
      const resposta = await http()
        .get('/api/v1/me')
        .set('Authorization', opCasAdote.autorizacao)
        .expect(200);
      expect(resposta.body).toMatchObject({ papel: 'OPERADOR', todasUnidades: false });
      expect(resposta.body.unidades).toEqual([{ id: unidadeCasAdote, nome: 'CasAdote' }]);
    });

    it('catálogo de unidades mostra só as unidades do usuário; admin vê todas', async () => {
      const operadora = await http()
        .get('/api/v1/units')
        .set('Authorization', opCasAdote.autorizacao);
      expect(operadora.body.itens.map((u: { nome: string }) => u.nome)).toEqual(['CasAdote']);

      const adm = await http().get('/api/v1/units').set('Authorization', admin.autorizacao);
      expect(adm.body.total).toBeGreaterThan(1);
    });

    it('localizações de unidade alheia: 403', async () => {
      await http()
        .get(`/api/v1/locations?unidadeId=${unidadeCed}`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
    });
  });

  describe('fotos (ainda sem animal: controle por autoria)', () => {
    it('outro operador não confirma nem reaproveita o id da foto alheia', async () => {
      const id = randomUUID();
      await http()
        .post('/api/v1/fotos')
        .set('Authorization', opCasAdote.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ id, tipoMidia: 'image/jpeg', tamanhoBytes: 1000 })
        .expect(201);

      await http()
        .post(`/api/v1/fotos/${id}/confirmacao`)
        .set('Authorization', opCed.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .expect(403);
      await http()
        .post('/api/v1/fotos')
        .set('Authorization', opCed.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ id, tipoMidia: 'image/png', tamanhoBytes: 2000 })
        .expect(403);
    });

    it('não permite vincular à ficha uma foto enviada por outro usuário', async () => {
      const fotoAlheia = await fotoConfirmada(opCasAdote);
      const resposta = await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', opCed.autorizacao)
        .send(admissaoCasAdote(fotoAlheia, unidadeCed))
        .expect(403);
      expect(resposta.body.mensagem).toBe('Foto enviada por outro usuário');
    });
  });

  describe('animais', () => {
    it('operadora cadastra na própria unidade', async () => {
      const foto = await fotoConfirmada(opCasAdote);
      const resposta = await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', opCasAdote.autorizacao)
        .send(admissaoCasAdote(foto))
        .expect(201);
      animalId = resposta.body.id;
      expect(resposta.body.unidadeNome).toBe('CasAdote');
    });

    it('operadora não cadastra em unidade alheia, mesmo enviando o id dela', async () => {
      const foto = await fotoConfirmada(opCasAdote);
      await http()
        .post('/api/v1/animals')
        .set('Idempotency-Key', randomUUID())
        .set('Authorization', opCasAdote.autorizacao)
        .send(admissaoCasAdote(foto, unidadeCed))
        .expect(403);
    });

    it('listagem do outro operador não traz o animal, nem pedindo a unidade pelo filtro', async () => {
      const semFiltro = await http().get('/api/v1/animals').set('Authorization', opCed.autorizacao);
      expect(semFiltro.body.total).toBe(0);

      const comFiltro = await http()
        .get(`/api/v1/animals?unidadeId=${unidadeCasAdote}`)
        .set('Authorization', opCed.autorizacao);
      expect(comFiltro.body.total).toBe(0);

      const dona = await http().get('/api/v1/animals').set('Authorization', opCasAdote.autorizacao);
      expect(dona.body.itens.map((a: { id: string }) => a.id)).toContain(animalId);
    });

    it('consulta direta de animal alheio: 403 e nenhuma URL de foto', async () => {
      const alheio = await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCed.autorizacao)
        .expect(403);
      expect(JSON.stringify(alheio.body)).not.toContain('storage.invalid');

      const dona = await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(200);
      expect(dona.body.fotoEntradaUrl).toContain('storage.invalid/leitura');
    });

    it('edição de animal alheio: 403', async () => {
      await http()
        .patch(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCed.autorizacao)
        .send({ versao: 1, nome: 'Invasor' })
        .expect(403);
    });

    it('operadora não transfere o animal para unidade em que não trabalha', async () => {
      await http()
        .patch(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCasAdote.autorizacao)
        .send({ versao: 1, unidadeId: unidadeCed, localizacaoId: catalogo.coloniaId })
        .expect(403);
    });

    it('admin transfere para o CED; a partir daí o escopo acompanha a nova unidade', async () => {
      await http()
        .patch(`/api/v1/animals/${animalId}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, unidadeId: unidadeCed, localizacaoId: catalogo.coloniaId })
        .expect(200);

      await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
      await http()
        .get(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCed.autorizacao)
        .expect(200);
    });
  });

  describe('saúde e prontuário', () => {
    it('evento de saúde só por quem tem acesso à unidade atual do animal', async () => {
      const evento = { tipo: 'VACINA', descricao: 'V10', data: '2026-10-01' };
      await http()
        .post(`/api/v1/animals/${animalId}/health-events`)
        .set('Authorization', opCasAdote.autorizacao)
        .send(evento)
        .expect(403);
      await http()
        .post(`/api/v1/animals/${animalId}/health-events`)
        .set('Authorization', opCed.autorizacao)
        .send(evento)
        .expect(201);
      await http()
        .get(`/api/v1/animals/${animalId}/health-events`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
    });

    it('prontuário em PDF: 403 fora do escopo, PDF dentro', async () => {
      await http()
        .get(`/api/v1/animals/${animalId}/prontuario`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
      const pdf = await http()
        .get(`/api/v1/animals/${animalId}/prontuario`)
        .set('Authorization', opCed.autorizacao)
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
    });
  });

  describe('arquivamento', () => {
    it('só quem tem acesso arquiva', async () => {
      await http()
        .delete(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
      await http()
        .delete(`/api/v1/animals/${animalId}`)
        .set('Authorization', opCed.autorizacao)
        .expect(204);
    });
  });
});
