import { randomUUID } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';
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
  let admin: UsuarioTeste;
  let opCasAdote: UsuarioTeste;
  let opCed: UsuarioTeste;
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
    admin = await ambiente.usuario('admin-cadastro', PapelUsuario.ADMIN);
    opCasAdote = await ambiente.usuario('op-casadote-cadastro', PapelUsuario.OPERADOR, [
      'CasAdote',
    ]);
    opCed = await ambiente.usuario('op-ced-cadastro', PapelUsuario.OPERADOR, ['CED']);

    const criado = await http()
      .post('/api/v1/responsibles')
      .set('Authorization', admin.autorizacao)
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
    it('operador de uma só unidade cadastra sem unidade nem localização; ficha traz responsável e endereço', async () => {
      const resposta = await cadastrar(opCasAdote, {
        nome: 'Luna',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });

      expect(resposta.status).toBe(201);
      expect(resposta.body).toMatchObject({
        unidadeId: unidadeCasAdote,
        responsavelNome: 'Maria Fictícia',
        responsavelEndereco: 'Rua das Flores, 10',
      });
      expect(resposta.body).not.toHaveProperty('localizacaoId');
      expect(resposta.body).not.toHaveProperty('localizacaoNome');
    });

    it('rejeita localizacaoId com 400 (campo desconhecido)', async () => {
      const resposta = await cadastrar(opCasAdote, {
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
      const criado = await cadastrar(opCasAdote, {
        nome: 'Nina',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      expect(criado.status).toBe(201);

      const resposta = await http()
        .patch(`/api/v1/animals/${criado.body.id}`)
        .set('Authorization', opCasAdote.autorizacao)
        .send({ versao: 1, responsavelId: null })
        .expect(400);
      expect(JSON.stringify(resposta.body.mensagem)).toContain('responsavelId');
    });
  });

  describe('onça', () => {
    it('catálogo oferece a espécie Onça com as raças pintada e parda', async () => {
      const especies = await http()
        .get('/api/v1/species')
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(especies.body.itens.map((e: { nome: string }) => e.nome)).toEqual(
        expect.arrayContaining(['Onça']),
      );
      expect(especies.body.itens.map((e: { nome: string }) => e.nome)).not.toContain(
        'Onça-pintada',
      );

      const racas = await http()
        .get(`/api/v1/breeds?especieId=${especieOnca}`)
        .set('Authorization', admin.autorizacao)
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

      const ok = await cadastrar(opCasAdote, {
        nome: 'Bagheera',
        especieId: especieOnca,
        racaId: parda.id,
        responsavelId,
        frente: 'CED',
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ racaNome: 'Onça-parda', especieNome: 'Onça' });

      const errado = await cadastrar(opCasAdote, {
        nome: 'Sombra',
        especieId: especieOnca,
        racaId: srdCao.id,
        responsavelId,
        frente: 'CED',
      });
      expect(errado.status).toBe(400);
    });
  });

  describe('privacidade e autorização de responsáveis', () => {
    it('operador não recebe e-mail nem telefone; administrador recebe', async () => {
      const operador = await http()
        .get('/api/v1/responsibles')
        .set('Authorization', opCed.autorizacao)
        .expect(200);
      const item = operador.body.itens.find((r: { id: string }) => r.id === responsavelId);
      expect(item).toMatchObject({ nome: 'Maria Fictícia', endereco: 'Rua das Flores, 10' });
      expect(item).not.toHaveProperty('email');
      expect(item).not.toHaveProperty('telefone');

      const adm = await http()
        .get('/api/v1/responsibles')
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(adm.body.itens.find((r: { id: string }) => r.id === responsavelId)).toMatchObject({
        email: 'maria@exemplo.invalid',
        telefone: '(11) 90000-0000',
      });
    });

    it('operador de outra unidade não edita o responsável de animais alheios (403); quem tem vínculo edita', async () => {
      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', opCed.autorizacao)
        .send({ endereco: 'Endereço indevido' })
        .expect(403);

      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', opCasAdote.autorizacao)
        .send({ endereco: 'Rua Nova, 20', email: 'novo@exemplo.invalid' })
        .expect(200);
    });

    it('responsável ainda sem animais pode ser corrigido por qualquer operador', async () => {
      const novo = await http()
        .post('/api/v1/responsibles')
        .set('Authorization', opCed.autorizacao)
        .send({ nome: 'Sem Animais' })
        .expect(201);
      await http()
        .patch(`/api/v1/responsibles/${novo.body.id}`)
        .set('Authorization', opCed.autorizacao)
        .send({ endereco: 'Rua Y' })
        .expect(200);
    });

    it('nome só com espaços é recusado (400) na criação e na edição', async () => {
      await http()
        .post('/api/v1/responsibles')
        .set('Authorization', admin.autorizacao)
        .send({ nome: '   ' })
        .expect(400);
      await http()
        .patch(`/api/v1/responsibles/${responsavelId}`)
        .set('Authorization', admin.autorizacao)
        .send({ nome: '   ' })
        .expect(400);
    });

    it('a auditoria da edição guarda só os nomes dos campos, sem e-mail nem endereço', async () => {
      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=Responsible&entidadeId=${responsavelId}`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      const edicao = trilha.body.itens.find(
        (e: { acao: string }) => e.acao === 'RESPONSAVEL_ATUALIZADO',
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
    it('aceita filtrar por AtendimentoClinico, recusa entidade desconhecida e restringe a ADMIN', async () => {
      const animal = await cadastrar(opCasAdote, {
        nome: 'Pipoca',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      const atendimento = await http()
        .post(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', opCasAdote.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'Texto clínico sigiloso' })
        .expect(201);

      const trilha = await http()
        .get(`/api/v1/auditoria?entidade=AtendimentoClinico&entidadeId=${atendimento.body.id}`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(trilha.body.itens.map((e: { acao: string }) => e.acao)).toContain(
        'ATENDIMENTO_CLINICO_CRIADO',
      );
      expect(JSON.stringify(trilha.body)).not.toContain('Texto clínico sigiloso');

      await http()
        .get('/api/v1/auditoria?entidade=Usuario')
        .set('Authorization', admin.autorizacao)
        .expect(400);
      await http()
        .get('/api/v1/auditoria?entidade=AtendimentoClinico')
        .set('Authorization', opCasAdote.autorizacao)
        .expect(403);
    });

    it('dados clínicos de um animal não são acessíveis por operador de outra unidade', async () => {
      const animal = await cadastrar(opCasAdote, {
        nome: 'Tom',
        especieId: especieCao,
        responsavelId,
        frente: 'CASADOTE',
      });
      await http()
        .post(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', opCasAdote.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({ anamnese: 'x' })
        .expect(201);

      await http()
        .get(`/api/v1/animals/${animal.body.id}/atendimentos`)
        .set('Authorization', opCed.autorizacao)
        .expect(403);
      await http()
        .get(`/api/v1/animals/${animal.body.id}/prontuario`)
        .set('Authorization', opCed.autorizacao)
        .expect(403);
    });
  });
});
