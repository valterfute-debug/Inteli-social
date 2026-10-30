import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

describe('Raças por espécie (HTTP e PostgreSQL isolado)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let conta: UsuarioTeste;
  let cao: string;
  let gato: string;
  const http = () => request(ambiente.app.getHttpServer());
  const criar = (nome: string, especieId = cao) =>
    http().post('/api/v1/breeds').set('Authorization', conta.autorizacao).send({ nome, especieId });
  const editar = (id: string, body: object) =>
    http().patch(`/api/v1/breeds/${id}`).set('Authorization', conta.autorizacao).send(body);

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    conta = await ambiente.usuario('gestor-racas');
    cao = (await ambiente.prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id;
    gato = (await ambiente.prisma.species.findUniqueOrThrow({ where: { name: 'Gato' } })).id;
  });
  afterAll(async () => {
    await ambiente?.encerrar();
  });

  it('cria, normaliza espaços, separa espécies e audita na mesma transação', async () => {
    const raca = await criar('  Raça   sintética  ').expect(201);
    expect(raca.body).toEqual({ id: expect.any(String), nome: 'Raça sintética', especieId: cao });
    await criar('raça sintética').expect(409);
    await criar('Raça sintética', gato).expect(201);
    const lista = await http()
      .get(`/api/v1/breeds?especieId=${gato}`)
      .set('Authorization', conta.autorizacao)
      .expect(200);
    expect(lista.body.itens.every((item: { especieId: string }) => item.especieId === gato)).toBe(
      true,
    );
    const evento = await ambiente.prisma.eventoAuditoria.findFirstOrThrow({
      where: { entidadeId: raca.body.id },
    });
    expect(evento).toMatchObject({ entidade: 'Breed', acao: 'RACA_CRIADA', usuarioId: conta.id });
    await http()
      .get(`/api/v1/auditoria?entidade=Breed&entidadeId=${raca.body.id}`)
      .set('Authorization', conta.autorizacao)
      .expect(200);
  });

  it('duas criações simultâneas com grafia diferente resultam em um único registro', async () => {
    const respostas = await Promise.all([criar('Raça concorrente'), criar('RAÇA CONCORRENTE')]);
    expect(respostas.map((item) => item.status).sort()).toEqual([201, 409]);
    expect(
      await ambiente.prisma.breed.count({
        where: { speciesId: cao, name: { equals: 'raça concorrente', mode: 'insensitive' } },
      }),
    ).toBe(1);
  });

  it('renomeia sem mudar IDs, espécie ou vínculos e atualiza o nome na ficha', async () => {
    const raca = (await criar('Nome anterior').expect(201)).body;
    const responsavel = await ambiente.prisma.responsible.create({
      data: { name: 'Tutor fictício' },
    });
    const animal = await ambiente.prisma.animal.create({
      data: {
        id: randomUUID(),
        publicId: 'AM-SINTETICO-RACA',
        name: 'Animal sintético',
        speciesId: cao,
        breedId: raca.id,
        responsibleId: responsavel.id,
        unitId: await ambiente.idUnidade('CasAdote'),
        front: 'CASADOTE',
      },
    });
    const atualizado = await editar(raca.id, { nome: 'Nome corrigido' }).expect(200);
    expect(atualizado.body).toEqual({ id: raca.id, nome: 'Nome corrigido', especieId: cao });
    const ficha = await http()
      .get(`/api/v1/animals/${animal.id}`)
      .set('Authorization', conta.autorizacao)
      .expect(200);
    expect(ficha.body.racaNome).toBe('Nome corrigido');
    expect(ficha.body.racaId).toBe(raca.id);
    const evento = await ambiente.prisma.eventoAuditoria.findFirstOrThrow({
      where: { entidadeId: raca.id, acao: 'RACA_ATUALIZADA' },
    });
    expect(evento.camposAlterados).toEqual({
      name: { antes: 'Nome anterior', depois: 'Nome corrigido' },
    });
    await editar(raca.id, { nome: 'Inválida', especieId: gato }).expect(400);
    await editar(raca.id, { nome: 'RAÇA SINTÉTICA' }).expect(409);
    const segunda = (await criar('Outra raça').expect(201)).body;
    const concorrentes = await Promise.all([
      editar(raca.id, { nome: 'Renomeação concorrente' }),
      editar(segunda.id, { nome: 'RENOMEAÇÃO CONCORRENTE' }),
    ]);
    expect(concorrentes.map((item) => item.status).sort()).toEqual([200, 409]);
  });

  it('recusa nomes inválidos, espécie inexistente/inativa e raça inexistente', async () => {
    for (const nome of ['', '   ', 'A', 'x'.repeat(121)]) await criar(nome).expect(400);
    await criar('Raça', randomUUID()).expect(404);
    const inativa = await ambiente.prisma.species.create({
      data: { name: 'Espécie inativa fictícia', deletedAt: new Date() },
    });
    await criar('Raça', inativa.id).expect(404);
    await editar(randomUUID(), { nome: 'Raça' }).expect(404);
    const raca = (await criar('Raça para validar').expect(201)).body;
    await editar(raca.id, {}).expect(400);
    await editar(raca.id, { nome: null }).expect(400);
    await editar('uuid-invalido', { nome: 'Raça' }).expect(400);
  });

  it('exige login e conta liberada também nas escritas', async () => {
    const raca = (await criar('Raça protegida').expect(201)).body;
    const naoLiberada = await ambiente.usuario('sem-acesso-racas', 'nao-liberado');
    const desativada = await ambiente.usuario('conta-inativa-racas', 'desativado');
    for (const [metodo, path, body] of [
      ['post', '/api/v1/breeds', { nome: 'Protegida', especieId: cao }],
      ['patch', `/api/v1/breeds/${raca.id}`, { nome: 'Protegida' }],
    ] as const) {
      await http()[metodo](path).send(body).expect(401);
      for (const usuario of [naoLiberada, desativada]) {
        await http()[metodo](path).set('Authorization', usuario.autorizacao).send(body).expect(403);
      }
    }
  });
});
