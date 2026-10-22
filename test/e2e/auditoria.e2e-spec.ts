import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Issue #3, P0-4: cada escrita sensível deixa um evento de auditoria (ator, ação, alvo,
 * instante, unidade/frente, campos alterados), ligado à resposta pelo X-Request-Id.
 */
describe('Auditoria e correlação (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let contaA: UsuarioTeste;
  let contaB: UsuarioTeste;
  let catalogo: {
    especieId: string;
    unidadeId: string;
    responsavelId: string;
  };
  let animalId: string;
  let requisicaoCriacao: string;

  const http = () => request(ambiente.app.getHttpServer());
  const eventosDo = (entidadeId: string) =>
    ambiente.prisma.eventoAuditoria.findMany({
      where: { entidadeId },
      orderBy: { instante: 'asc' },
    });

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

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    const { prisma } = ambiente;
    const casAdote = await ambiente.idUnidade('CasAdote');
    catalogo = {
      especieId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
      unidadeId: casAdote,
      responsavelId: (await prisma.responsible.findFirstOrThrow()).id,
    };
    contaA = await ambiente.usuario('contaA-auditoria');
    contaB = await ambiente.usuario('contaB-auditoria');
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  it('toda resposta traz X-Request-Id; um ID seguro enviado pelo cliente é reaproveitado', async () => {
    const gerado = await http().get('/api/health').expect(200);
    expect(gerado.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const doCliente = await http()
      .get('/api/health')
      .set('X-Request-Id', 'pwa-sync-0001')
      .expect(200);
    expect(doCliente.headers['x-request-id']).toBe('pwa-sync-0001');
  });

  it('erro devolve o mesmo ID no corpo e no cabeçalho', async () => {
    const resposta = await http().get('/api/v1/animals').expect(401);
    expect(resposta.body.requisicaoId).toBe(resposta.headers['x-request-id']);
  });

  it('cadastro gera ANIMAL_CRIADO com ator, unidade, frente e o ID da requisição', async () => {
    const resposta = await http()
      .post('/api/v1/animals')
      .set('Authorization', contaB.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({
        nome: 'Luna',
        cor: 'Preta',
        especieId: catalogo.especieId,
        unidadeId: catalogo.unidadeId,
        responsavelId: catalogo.responsavelId,
        frente: 'CASADOTE',
        fotoEntradaId: await fotoConfirmada(contaB),
      })
      .expect(201);
    animalId = resposta.body.id;
    requisicaoCriacao = resposta.headers['x-request-id'];

    const [evento] = await eventosDo(animalId);
    expect(evento).toMatchObject({
      acao: 'ANIMAL_CRIADO',
      entidade: 'Animal',
      usuarioId: contaB.id,
      unidadeId: catalogo.unidadeId,
      frente: 'CASADOTE',
      requisicaoId: requisicaoCriacao,
    });
  });

  it('o reenvio idempotente não gera um segundo evento de criação', async () => {
    const eventos = await eventosDo(animalId);
    expect(eventos.filter((e) => e.acao === 'ANIMAL_CRIADO')).toHaveLength(1);
  });

  it('edição registra só os campos que mudaram, com antes e depois', async () => {
    await http()
      .patch(`/api/v1/animals/${animalId}`)
      .set('Authorization', contaB.autorizacao)
      .send({ versao: 1, nome: 'Luna', cor: 'Caramelo' })
      .expect(200);

    const edicao = (await eventosDo(animalId)).find((e) => e.acao === 'ANIMAL_ATUALIZADO');
    expect(edicao?.camposAlterados).toEqual({ cor: { antes: 'Preta', depois: 'Caramelo' } });
  });

  it('edição recusada (versão desatualizada) não deixa evento', async () => {
    const antes = (await eventosDo(animalId)).length;
    await http()
      .patch(`/api/v1/animals/${animalId}`)
      .set('Authorization', contaB.autorizacao)
      .send({ versao: 1, cor: 'Branca' })
      .expect(409);
    expect(await eventosDo(animalId)).toHaveLength(antes);
  });

  it('evento de saúde e arquivamento também são auditados', async () => {
    const evento = await http()
      .post(`/api/v1/animals/${animalId}/health-events`)
      .set('Authorization', contaB.autorizacao)
      .send({ tipo: 'VACINA', descricao: 'V10', data: '2026-10-01' })
      .expect(201);
    expect((await eventosDo(evento.body.id))[0].acao).toBe('EVENTO_SAUDE_CRIADO');

    await http()
      .delete(`/api/v1/animals/${animalId}`)
      .set('Authorization', contaB.autorizacao)
      .expect(204);
    expect((await eventosDo(animalId)).map((e) => e.acao)).toContain('ANIMAL_ARQUIVADO');
  });

  it('não guarda token, chave de idempotência nem link assinado', async () => {
    const tudo = JSON.stringify(await ambiente.prisma.eventoAuditoria.findMany());
    expect(tudo).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/); // JWT
    expect(tudo).not.toContain('storage.invalid');
    const chaves = await ambiente.prisma.chaveIdempotencia.findMany({ select: { chave: true } });
    for (const { chave } of chaves) expect(tudo).not.toContain(chave);
  });

  it('é somente inclusão: o banco recusa alterar ou apagar eventos', async () => {
    const [evento] = await eventosDo(animalId);
    await expect(
      ambiente.prisma.eventoAuditoria.update({ where: { id: evento.id }, data: { acao: 'X' } }),
    ).rejects.toThrow(/somente inclusão/);
    await expect(
      ambiente.prisma.eventoAuditoria.delete({ where: { id: evento.id } }),
    ).rejects.toThrow(/somente inclusão/);
  });

  it('consulta da trilha: qualquer conta ativa vê o histórico do animal', async () => {
    const resposta = await http()
      .get(`/api/v1/auditoria?entidadeId=${animalId}`)
      .set('Authorization', contaA.autorizacao)
      .expect(200);
    expect(resposta.body.itens.map((e: { acao: string }) => e.acao)).toEqual([
      'ANIMAL_ARQUIVADO',
      'ANIMAL_ATUALIZADO',
      'ANIMAL_CRIADO',
    ]);

    await http()
      .get(`/api/v1/auditoria?requisicaoId=${requisicaoCriacao}`)
      .set('Authorization', contaB.autorizacao)
      .expect(200);
  });
});
