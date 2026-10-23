import { randomUUID } from 'node:crypto';
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
  let contaA: UsuarioTeste;
  let contaB: UsuarioTeste;
  let contaC: UsuarioTeste;
  let unidades: { ccpa: string; ced: string; casAdote: string; mantenedor: string };
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
      mantenedor: await ambiente.idUnidade('Mantenedor'),
    };
    especieCao = (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id;
    especieSilvestre = (
      await prisma.species.findUniqueOrThrow({ where: { name: 'Outro silvestre' } })
    ).id;
    responsavelId = (await prisma.responsible.findFirstOrThrow()).id;
    contaA = await ambiente.usuario('contaA-areas');
    contaB = await ambiente.usuario('op-ced-areas');
    contaC = await ambiente.usuario('op-ced-casadote-areas');
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  describe('microchip', () => {
    it('é guardado como texto: zeros à esquerda e 20 dígitos são preservados', async () => {
      const comZeros = await cadastrar(contaA, cadastroCed('000123456789'));
      expect(comZeros.status).toBe(201);
      expect(comZeros.body.microchip).toBe('000123456789');

      const longo = await cadastrar(contaA, cadastroCed('12345678901234567890'));
      expect(longo.status).toBe(201);
      expect(longo.body.microchip).toBe('12345678901234567890');

      const lido = await http()
        .get(`/api/v1/animals/${comZeros.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(lido.body.microchip).toBe('000123456789');
    });

    it('recusa letras e mais de 20 dígitos (400)', async () => {
      expect((await cadastrar(contaA, cadastroCed('12AB34'))).status).toBe(400);
      expect((await cadastrar(contaA, cadastroCed('1'.repeat(21)))).status).toBe(400);
    });

    it('não duplica: o mesmo microchip devolve 409 apontando o animal existente', async () => {
      const primeiro = await cadastrar(contaA, cadastroCed('555000111'));
      expect(primeiro.status).toBe(201);

      const duplicado = await cadastrar(contaA, cadastroCed('555000111'));
      expect(duplicado.status).toBe(409);
      expect(duplicado.body.detalhes).toMatchObject({ animalExistenteId: primeiro.body.id });
    });

    it('é exigido, com sexo, idade, peso e porte, no CED e no CCPA (não silvestre)', async () => {
      for (const frente of ['CED', 'CCPA']) {
        const resposta = await cadastrar(contaA, {
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
      const semNome = await cadastrar(contaA, {
        especieId: especieSilvestre,
        responsavelId,
        frente: 'CED',
      });
      expect(semNome.status).toBe(400);
      expect(JSON.stringify(semNome.body.mensagem)).toContain('nome');

      const ok = await cadastrar(contaA, {
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
      const a = await cadastrar(contaA, corpo);
      const b = await cadastrar(contaA, corpo);

      expect([a.status, b.status]).toEqual([201, 201]);
      expect(a.body.id).not.toBe(b.body.id);
      expect(a.body.identificadorPublico).not.toBe(b.body.identificadorPublico);
    });

    it('mantenedor é uma atuação (frente): aparece na ficha e na linha do tempo', async () => {
      const criado = await cadastrar(contaA, {
        nome: 'Onça do Mantenedor',
        especieId: especieSilvestre,
        responsavelId,
        frente: 'MANTENEDOR',
      });
      expect(criado.status).toBe(201);
      expect(criado.body).toMatchObject({ frente: 'MANTENEDOR' });
      const salvo = await ambiente.prisma.animal.findUniqueOrThrow({
        where: { id: criado.body.id },
      });
      expect(salvo.unitId).toBe(unidades.mantenedor);

      const linha = await http()
        .get(`/api/v1/animals/${criado.body.id}/movimentacoes`)
        .set('Authorization', contaB.autorizacao)
        .expect(200);
      expect(linha.body.itens).toHaveLength(1);
      expect(linha.body.itens[0]).toMatchObject({
        frenteOrigem: null,
        frenteDestino: 'MANTENEDOR',
      });
    });

    it('o código NÃO proíbe microchip em silvestre (coexistência com o nome; regra pendente)', async () => {
      const resposta = await cadastrar(contaA, {
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
      const criado = await cadastrar(contaA, cadastroCed('888000111', { nome: 'Bolota' }));
      expect(criado.status).toBe(201);
      const { id, identificadorPublico, criadoEm } = criado.body;
      expect(criado.body.frente).toBe('CED');

      const paraCasAdote = await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);
      expect(paraCasAdote.body).toMatchObject({
        id,
        identificadorPublico,
        microchip: '888000111',
        frente: 'CASADOTE',
        versao: 2,
        criadoEm,
      });

      const paraCcpa = await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 2, frente: 'CCPA' })
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
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(mesmoChip.body.total).toBe(1);

      // O histórico da passagem fica na trilha de auditoria (origem → destino, quem e quando).
      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=Animal&entidadeId=${id}&limite=50`)
        .set('Authorization', contaA.autorizacao)
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
      expect(trilha.body.itens.every((e: { usuarioId: string }) => e.usuarioId === contaA.id)).toBe(
        true,
      );
    });

    it('registra a linha do tempo de áreas (entrada e passagens), consultável por qualquer conta', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000666', { nome: 'Linha do tempo' }));
      const id = criado.body.id;
      await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);
      await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', contaB.autorizacao)
        .send({ versao: 2, frente: 'CCPA' })
        .expect(200);

      const resposta = await http()
        .get(`/api/v1/animals/${id}/movimentacoes`)
        .set('Authorization', contaC.autorizacao)
        .expect(200);

      expect(resposta.body.total).toBe(3);
      const caminho = resposta.body.itens
        .map((m: { frenteOrigem: string | null; frenteDestino: string }) => [
          m.frenteOrigem,
          m.frenteDestino,
        ])
        .reverse();
      expect(caminho).toEqual([
        [null, 'CED'],
        ['CED', 'CASADOTE'],
        ['CASADOTE', 'CCPA'],
      ]);
      expect(resposta.body.itens[0]).toMatchObject({
        animalId: id,
        usuarioId: contaB.id,
      });
      expect(resposta.body.itens[2]).toMatchObject({ frenteOrigem: null, usuarioId: contaA.id });
    });

    it('edição que não muda de área e edição recusada não geram movimentação', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000777'));
      const id = criado.body.id;
      await http()
        .patch(`/api/v1/animals/${id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, cor: 'Preta' })
        .expect(200);
      // Volta para o CED sem os dados de identificação de outro animal: 400 e nada muda.
      const semDados = await cadastrar(contaA, {
        nome: 'Sem dados',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      await http()
        .patch(`/api/v1/animals/${semDados.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CED' })
        .expect(400);

      const doPrimeiro = await http()
        .get(`/api/v1/animals/${id}/movimentacoes`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(doPrimeiro.body.total).toBe(1);
      const doSegundo = await http()
        .get(`/api/v1/animals/${semDados.body.id}/movimentacoes`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(doSegundo.body.total).toBe(1);
    });

    it('o histórico sobrevive ao arquivamento; animal inexistente: 404; sem login: 401', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000888'));
      const id = criado.body.id;
      await http()
        .delete(`/api/v1/animals/${id}`)
        .set('Authorization', contaA.autorizacao)
        .expect(204);

      const resposta = await http()
        .get(`/api/v1/animals/${id}/movimentacoes`)
        .set('Authorization', contaB.autorizacao)
        .expect(200);
      expect(resposta.body.total).toBe(1);
      await http()
        .get(`/api/v1/animals/${randomUUID()}/movimentacoes`)
        .set('Authorization', contaB.autorizacao)
        .expect(404);
      await http().get(`/api/v1/animals/${id}/movimentacoes`).expect(401);
    });

    it('a movimentação não pode ser alterada nem apagada pela API', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000999'));
      const id = criado.body.id;
      const rota = `/api/v1/animals/${id}/movimentacoes`;
      const tentativas = [http().post(rota), http().patch(rota), http().delete(rota)];
      for (const tentativa of tentativas) {
        await tentativa.set('Authorization', contaA.autorizacao).send({}).expect(404);
      }
    });

    it('a unidade acompanha a frente e não aparece na resposta', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000222'));
      const atualizado = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);

      expect(atualizado.body.frente).toBe('CASADOTE');
      expect(atualizado.body).not.toHaveProperty('unidadeId');
      const salvo = await ambiente.prisma.animal.findUniqueOrThrow({
        where: { id: criado.body.id },
      });
      expect(salvo.unitId).toBe(unidades.casAdote);
    });

    it('o CasAdote recebe animal que já tem identificação, sem repetir exigências', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000333'));
      const recebido = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);
      expect(recebido.body.frente).toBe('CASADOTE');

      // Um cadastro NOVO direto no CasAdote não exige os campos extras (RN003).
      const direto = await cadastrar(contaA, {
        nome: 'Direto',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      expect(direto.status).toBe(201);
    });

    it('voltar para CED/CCPA sem os dados de identificação é recusado (400) e nada muda', async () => {
      const direto = await cadastrar(contaA, {
        nome: 'Sem dados',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      const recusado = await http()
        .patch(`/api/v1/animals/${direto.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CED' })
        .expect(400);
      expect(JSON.stringify(recusado.body.mensagem)).toContain('microchip');

      const lido = await http()
        .get(`/api/v1/animals/${direto.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(lido.body).toMatchObject({ frente: 'CASADOTE', versao: 1 });
    });

    it('qualquer conta passa o animal do CED ao CasAdote e todas continuam vendo a ficha', async () => {
      const criado = await cadastrar(contaB, cadastroCed('888000444'));
      expect(criado.status).toBe(201);

      await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', contaB.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);

      // Depois da passagem, quem cadastrou e as outras contas continuam enxergando o animal.
      for (const quem of [contaB, contaC, contaA]) {
        const ficha = await http()
          .get(`/api/v1/animals/${criado.body.id}`)
          .set('Authorization', quem.autorizacao)
          .expect(200);
        expect(ficha.body).toMatchObject({ frente: 'CASADOTE' });
      }
    });

    it('atendimentos continuam ligados ao mesmo animal depois da passagem', async () => {
      const criado = await cadastrar(contaA, cadastroCed('888000555'));
      const atendimento = await http()
        .post(`/api/v1/animals/${criado.body.id}/atendimentos`)
        .set('Authorization', contaA.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'Acompanhamento no CED' })
        .expect(201);

      await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .send({ versao: 1, frente: 'CASADOTE' })
        .expect(200);

      const historico = await http()
        .get(`/api/v1/animals/${criado.body.id}/atendimentos`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      // A admissão (criada com o cadastro) e o acompanhamento seguem no mesmo animal.
      expect(historico.body.total).toBe(2);
      expect(historico.body.itens.map((i: { id: string }) => i.id)).toContain(atendimento.body.id);
      expect(historico.body.itens.map((i: { tipo: string }) => i.tipo).sort()).toEqual([
        'ACOMPANHAMENTO',
        'ADMISSAO',
      ]);
    });
  });
});
