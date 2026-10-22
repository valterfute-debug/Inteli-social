import { randomUUID } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Identificação do animal (microchip, silvestres) e passagem entre áreas (CED, CCPA, CasAdote).
 * Verifica o comportamento IMPLEMENTADO hoje; regras ainda sem decisão da equipe (nome × microchip
 * em silvestres, condições de transferência, mantenedor) estão em docs/decisoes-pendentes.md.
 * Todos os dados são fictícios.
 */
describe('Identificação e passagem entre áreas (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let admin: UsuarioTeste;
  let opCed: UsuarioTeste;
  let opAmbas: UsuarioTeste;
  let unidades: { ccpa: string; ced: string; casAdote: string };
  let especieCao: string;
  let especieSilvestre: string;
  let responsavelId: string;

  const http = () => request(ambiente.app.getHttpServer());

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

  async function cadastrar(quem: UsuarioTeste, corpo: Record<string, unknown>) {
    return http()
      .post('/api/v1/animals')
      .set('Authorization', quem.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({ fotoEntradaId: await fotoConfirmada(quem), ...corpo });
  }

  const cadastroCed = (microchip: string, extra: Record<string, unknown> = {}) => ({
    especieId: especieCao,
    responsavelId,
    frente: 'CED',
    microchip,
    sexo: 'FEMEA',
    idadeAproximadaMeses: 18,
    pesoKg: 9.5,
    porte: 'MEDIO',
    ...extra,
  });

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    const { prisma } = ambiente;
    unidades = {
      ccpa: await ambiente.idUnidade('CCPA'),
      ced: await ambiente.idUnidade('CED'),
      casAdote: await ambiente.idUnidade('CasAdote'),
    };
    especieCao = (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id;
    especieSilvestre = (
      await prisma.species.findUniqueOrThrow({ where: { name: 'Outro silvestre' } })
    ).id;
    responsavelId = (await prisma.responsible.findFirstOrThrow()).id;
    admin = await ambiente.usuario('admin-areas', PapelUsuario.ADMIN);
    opCed = await ambiente.usuario('op-ced-areas', PapelUsuario.OPERADOR, ['CED']);
    opAmbas = await ambiente.usuario('op-ced-casadote-areas', PapelUsuario.OPERADOR, [
      'CED',
      'CasAdote',
    ]);
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  describe('microchip', () => {
    it('é guardado como texto: zeros à esquerda e 20 dígitos são preservados', async () => {
      const comZeros = await cadastrar(admin, cadastroCed('000123456789'));
      expect(comZeros.status).toBe(201);
      expect(comZeros.body.microchip).toBe('000123456789');

      const longo = await cadastrar(admin, cadastroCed('12345678901234567890'));
      expect(longo.status).toBe(201);
      expect(longo.body.microchip).toBe('12345678901234567890');

      const lido = await http()
        .get(`/api/v1/animals/${comZeros.body.id}`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(lido.body.microchip).toBe('000123456789');
    });

    it('recusa letras e mais de 20 dígitos (400)', async () => {
      expect((await cadastrar(admin, cadastroCed('12AB34'))).status).toBe(400);
      expect((await cadastrar(admin, cadastroCed('1'.repeat(21)))).status).toBe(400);
    });

    it('não duplica: o mesmo microchip devolve 409 apontando o animal existente', async () => {
      const primeiro = await cadastrar(admin, cadastroCed('555000111'));
      expect(primeiro.status).toBe(201);

      const duplicado = await cadastrar(admin, cadastroCed('555000111'));
      expect(duplicado.status).toBe(409);
      expect(duplicado.body.detalhes).toMatchObject({ animalExistenteId: primeiro.body.id });
    });

    it('é exigido, com sexo, idade, peso e porte, no CED e no CCPA (não silvestre)', async () => {
      for (const frente of ['CED', 'CCPA']) {
        const resposta = await cadastrar(admin, {
          especieId: especieCao,
          responsavelId,
          frente,
        });
        expect(resposta.status).toBe(400);
        const texto = JSON.stringify(resposta.body.mensagem);
        for (const campo of ['microchip', 'sexo', 'idade aproximada', 'peso', 'porte']) {
          expect(texto).toContain(campo);
        }
      }
    });
  });

  describe('animais silvestres', () => {
    it('identificados pelo nome: exigem nome e dispensam os demais campos', async () => {
      const semNome = await cadastrar(admin, {
        especieId: especieSilvestre,
        responsavelId,
        frente: 'CED',
      });
      expect(semNome.status).toBe(400);
      expect(JSON.stringify(semNome.body.mensagem)).toContain('nome');

      const ok = await cadastrar(admin, {
        nome: 'Tuiuiú',
        especieId: especieSilvestre,
        responsavelId,
        frente: 'CED',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ nome: 'Tuiuiú', especieSilvestre: true, microchip: null });
    });

    it('nomes não são únicos: dois silvestres com o mesmo nome convivem', async () => {
      const corpo = { nome: 'Pacu', especieId: especieSilvestre, responsavelId, frente: 'CED' };
      const a = await cadastrar(admin, corpo);
      const b = await cadastrar(admin, corpo);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).not.toBe(b.body.id);
      expect(a.body.identificadorPublico).not.toBe(b.body.identificadorPublico);
    });

    it('o código NÃO proíbe microchip em silvestre (coexistência com o nome; regra pendente)', async () => {
      const resposta = await cadastrar(admin, {
        nome: 'Jaguatirica',
        microchip: '777000999',
        especieId: especieSilvestre,
        responsavelId,
        frente: 'CED',
      });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({ nome: 'Jaguatirica', microchip: '777000999' });
    });
  });

  describe('passagem entre áreas', () => {
    it('o mesmo cadastro segue de CED para CasAdote e depois CCPA, preservando identidade e histórico', async () => {
      const criado = await cadastrar(admin, cadastroCed('888000111', { nome: 'Bolota' }));
      expect(criado.status).toBe(201);
      const { id, identificadorPublico, criadoEm } = criado.body;
      expect(criado.body.frente).toBe('CED');

      const paraCasAdote = await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE', unidadeId: unidades.casAdote })
        .expect(200);
      expect(paraCasAdote.body).toMatchObject({
        id,
        identificadorPublico,
        microchip: '888000111',
        frente: 'CASADOTE',
        unidadeId: unidades.casAdote,
        versao: 2,
        criadoEm,
      });

      const paraCcpa = await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 2, frente: 'CCPA', unidadeId: unidades.ccpa })
        .expect(200);
      expect(paraCcpa.body).toMatchObject({
        id,
        microchip: '888000111',
        frente: 'CCPA',
        versao: 3,
      });

      // Nenhum animal novo foi criado: continua um só com esse microchip.
      const mesmoChip = await http()
        .get('/api/v1/animals?microchip=888000111')
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(mesmoChip.body.total).toBe(1);

      // O histórico da passagem fica na trilha de auditoria (origem → destino, quem e quando).
      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=Animal&entidadeId=${id}&limite=50`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      const movimentos = trilha.body.itens
        .filter((e: { acao: string }) => e.acao === 'ANIMAL_ATUALIZADO')
        .reverse()
        .map((e: { camposAlterados: { front: { antes: string; depois: string } } }) => ({
          de: e.camposAlterados.front.antes,
          para: e.camposAlterados.front.depois,
        }));
      expect(movimentos).toEqual([
        { de: 'CED', para: 'CASADOTE' },
        { de: 'CASADOTE', para: 'CCPA' },
      ]);
      expect(trilha.body.itens.every((e: { usuarioId: string }) => e.usuarioId === admin.id)).toBe(
        true,
      );
    });

    it('trocar só a frente não muda a unidade (a unidade segue o que for enviado)', async () => {
      const criado = await cadastrar(admin, cadastroCed('888000222', { unidadeId: unidades.ced }));
      const atualizado = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);

      expect(atualizado.body).toMatchObject({ frente: 'CASADOTE', unidadeId: unidades.ced });
    });

    it('o CasAdote recebe animal que já tem identificação, sem repetir exigências', async () => {
      const criado = await cadastrar(admin, cadastroCed('888000333'));
      const recebido = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE', unidadeId: unidades.casAdote })
        .expect(200);
      expect(recebido.body.frente).toBe('CASADOTE');

      // Um cadastro NOVO direto no CasAdote não exige os campos extras (RN003).
      const direto = await cadastrar(admin, {
        nome: 'Direto',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      expect(direto.status).toBe(201);
    });

    it('voltar para CED/CCPA sem os dados de identificação é recusado (400) e nada muda', async () => {
      const direto = await cadastrar(admin, {
        nome: 'Sem dados',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      const recusado = await http()
        .patch(`/api/v1/animals/${direto.body.id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, frente: 'CED' })
        .expect(400);
      expect(JSON.stringify(recusado.body.mensagem)).toContain('microchip');

      const lido = await http()
        .get(`/api/v1/animals/${direto.body.id}`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(lido.body).toMatchObject({ frente: 'CASADOTE', versao: 1 });
    });

    it('o operador do CED não consegue enviar o animal ao CasAdote; quem tem as duas unidades consegue', async () => {
      const criado = await cadastrar(opCed, cadastroCed('888000444'));
      expect(criado.status).toBe(201);
      expect(criado.body.unidadeId).toBe(unidades.ced);

      await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', opCed.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE', unidadeId: unidades.casAdote })
        .expect(403);

      await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', opAmbas.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE', unidadeId: unidades.casAdote })
        .expect(200);

      // Depois da passagem, o operador que só tem o CED deixa de enxergar o animal.
      await http()
        .get(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', opCed.autorizacao)
        .expect(403);
    });

    it('atendimentos continuam ligados ao mesmo animal depois da passagem', async () => {
      const criado = await cadastrar(admin, cadastroCed('888000555'));
      const atendimento = await http()
        .post(`/api/v1/animals/${criado.body.id}/atendimentos`)
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'Admissão no CED' })
        .expect(201);

      await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', admin.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE', unidadeId: unidades.casAdote })
        .expect(200);

      const historico = await http()
        .get(`/api/v1/animals/${criado.body.id}/atendimentos`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(historico.body.itens.map((i: { id: string }) => i.id)).toEqual([atendimento.body.id]);
    });
  });
});
