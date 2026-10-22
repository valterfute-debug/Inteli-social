import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Contrato novo do cadastro (sem unidade/localização, onça, responsável com endereço) e
 * privacidade/autorização de responsáveis e da auditoria, com HTTP real e banco real.
 * Todos os dados são fictícios.
 */
describe('Cadastro sem unidade/localização, onça e privacidade de responsáveis (e2e)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let contaA: UsuarioTeste;
  let contaB: UsuarioTeste;
  let contaC: UsuarioTeste;
  let unidadeCasAdote: string;
  let especieCao: string;
  let especieOnca: string;
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

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    const { prisma } = ambiente;
    unidadeCasAdote = await ambiente.idUnidade('CasAdote');
    especieCao = (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id;
    especieOnca = (await prisma.species.findUniqueOrThrow({ where: { name: 'Onça' } })).id;
    contaA = await ambiente.usuario('contaA-cadastro');
    contaB = await ambiente.usuario('op-casadote-cadastro');
    contaC = await ambiente.usuario('op-ced-cadastro');

    const criado = await http()
      .post('/api/v1/responsibles')
      .set('Authorization', contaA.autorizacao)
      .send({
        nome: 'Maria Fictícia',
        endereco: 'Rua das Flores, 10',
        email: 'maria@exemplo.invalid',
        telefone: '(11) 90000-0000',
      })
      .expect(201);
    responsavelId = criado.body.id;
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  describe('cadastro de animal', () => {
    it('conta cadastra sem unidade nem localização (a unidade segue a frente); ficha traz responsável e endereço', async () => {
      const resposta = await cadastrar(contaB, {
        nome: 'Luna',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        responsavelNome: 'Maria Fictícia',
        responsavelEndereco: 'Rua das Flores, 10',
      });
      expect(resposta.body).not.toHaveProperty('localizacaoId');
      expect(resposta.body).not.toHaveProperty('localizacaoNome');
      expect(resposta.body).not.toHaveProperty('unidadeId');
      expect(resposta.body).not.toHaveProperty('unidadeNome');
      const salvo = await ambiente.prisma.animal.findUniqueOrThrow({
        where: { id: resposta.body.id },
      });
      expect(salvo.unitId).toBe(unidadeCasAdote);
    });

    it('rejeita unidadeId com 400 (a unidade saiu do cadastro)', async () => {
      const resposta = await cadastrar(contaB, {
        nome: 'Rex',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
        unidadeId: unidadeCasAdote,
      });

      expect(resposta.status).toBe(400);
    });

    it('rejeita localizacaoId com 400 (campo desconhecido)', async () => {
      const resposta = await cadastrar(contaB, {
        nome: 'Rex',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
        localizacaoId: randomUUID(),
      });

      expect(resposta.status).toBe(400);
      expect(JSON.stringify(resposta.body.mensagem)).toContain('localizacaoId');
    });

    it('PATCH com null em campo obrigatório responde 400, não 500', async () => {
      const criado = await cadastrar(contaB, {
        nome: 'Nina',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      expect(criado.status).toBe(201);

      const resposta = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', contaB.autorizacao)
        .send({ versao: 1, responsavelId: null })
        .expect(400);
      expect(JSON.stringify(resposta.body.mensagem)).toContain('responsavelId');
    });
  });

  describe('onça', () => {
    it('catálogo oferece a espécie Onça com as raças pintada e parda', async () => {
      const especies = await http()
        .get('/api/v1/species')
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(especies.body.itens.map((e: { nome: string }) => e.nome)).toEqual(
        expect.arrayContaining(['Onça']),
      );
      expect(especies.body.itens.map((e: { nome: string }) => e.nome)).not.toContain(
        'Onça-pintada',
      );

      const racas = await http()
        .get(`/api/v1/breeds?especieId=${especieOnca}`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(racas.body.itens.map((r: { nome: string }) => r.nome).sort()).toEqual([
        'Onça-parda',
        'Onça-pintada',
      ]);
    });

    it('cadastra onça com a raça correta e recusa raça de outra espécie', async () => {
      const racas = await ambiente.prisma.breed.findMany({ where: { speciesId: especieOnca } });
      const parda = racas.find((r) => r.name === 'Onça-parda')!;
      const srdCao = await ambiente.prisma.breed.findFirstOrThrow({
        where: { speciesId: especieCao },
      });

      const ok = await cadastrar(contaB, {
        nome: 'Bagheera',
        especieId: especieOnca,
        racaId: parda.id,
        responsavelId,
        frente: 'CED',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ racaNome: 'Onça-parda', especieNome: 'Onça' });

      const errado = await cadastrar(contaB, {
        nome: 'Sombra',
        especieId: especieOnca,
        racaId: srdCao.id,
        responsavelId,
        frente: 'CED',
      });
      expect(errado.status).toBe(400);
    });
  });

  describe('responsáveis: contato, edição e auditoria', () => {
    it('toda conta ativa vê nome, endereço, e-mail e telefone (permissões iguais)', async () => {
      for (const quem of [contaC, contaA]) {
        const resposta = await http()
          .get('/api/v1/responsibles')
          .set('Authorization', quem.autorizacao)
          .expect(200);
        expect(
          resposta.body.itens.find((r: { id: string }) => r.id === responsavelId),
        ).toMatchObject({
          nome: 'Maria Fictícia',
          endereco: 'Rua das Flores, 10',
          email: 'maria@exemplo.invalid',
          telefone: '(11) 90000-0000',
        });
      }
    });

    it('qualquer conta edita o responsável, tenha ou não animais em "sua" unidade', async () => {
      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', contaC.autorizacao)
        .send({ endereco: 'Rua Nova, 20', email: 'novo@exemplo.invalid' })
        .expect(200);

      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', contaB.autorizacao)
        .send({ endereco: 'Rua Nova, 20' })
        .expect(200);
    });

    it('responsável recém-criado pode ser corrigido na sequência', async () => {
      const novo = await http()
        .post('/api/v1/responsibles')
        .set('Authorization', contaC.autorizacao)
        .send({ nome: 'Sem Animais' })
        .expect(201);
      await http()
        .patch(`/api/v1/responsibles/${novo.body.id}`)
        .set('Authorization', contaC.autorizacao)
        .send({ endereco: 'Rua Y' })
        .expect(200);
    });

    it('nome só com espaços é recusado (400) na criação e na edição', async () => {
      await http()
        .post('/api/v1/responsibles')
        .set('Authorization', contaA.autorizacao)
        .send({ nome: '   ' })
        .expect(400);
      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', contaA.autorizacao)
        .send({ nome: '   ' })
        .expect(400);
    });

    it('a auditoria da edição guarda só os nomes dos campos, sem e-mail nem endereço', async () => {
      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=Responsible&entidadeId=${responsavelId}`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      const edicao = trilha.body.itens.find(
        (e: { acao: string; camposAlterados: Record<string, unknown> | null }) =>
          e.acao === 'RESPONSAVEL_ATUALIZADO' && e.camposAlterados?.email !== undefined,
      );
      expect(edicao).toBeDefined();
      expect(Object.keys(edicao.camposAlterados)).toEqual(
        expect.arrayContaining(['endereco', 'email']),
      );
      const texto = JSON.stringify(trilha.body);
      expect(texto).not.toContain('novo@exemplo.invalid');
      expect(texto).not.toContain('maria@exemplo.invalid');
      expect(texto).not.toContain('Rua Nova, 20');
    });
  });

  describe('auditoria do prontuário', () => {
    it('aceita filtrar por AtendimentoClinico, recusa entidade desconhecida e vale para qualquer conta', async () => {
      const animal = await cadastrar(contaB, {
        nome: 'Pipoca',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      const atendimento = await http()
        .post(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', contaB.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'Texto clínico sigiloso' })
        .expect(201);

      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=AtendimentoClinico&entidadeId=${atendimento.body.id}`)
        .set('Authorization', contaA.autorizacao)
        .expect(200);
      expect(trilha.body.itens.map((e: { acao: string }) => e.acao)).toContain(
        'ATENDIMENTO_CLINICO_CRIADO',
      );
      expect(JSON.stringify(trilha.body)).not.toContain('Texto clínico sigiloso');

      await http()
        .get('/api/v1/auditoria?entidade=Usuario')
        .set('Authorization', contaA.autorizacao)
        .expect(400);
      await http()
        .get('/api/v1/auditoria?entidade=AtendimentoClinico')
        .set('Authorization', contaB.autorizacao)
        .expect(200);
    });

    it('dados clínicos de um animal são acessíveis a qualquer conta ativa', async () => {
      const animal = await cadastrar(contaB, {
        nome: 'Tom',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      await http()
        .post(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', contaB.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'x' })
        .expect(201);

      await http()
        .get(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', contaC.autorizacao)
        .expect(200);
      await http()
        .get(`/api/v1/animals/${animal.body.id}/prontuario`)
        .set('Authorization', contaC.autorizacao)
        .expect(200);
    });
  });
});
