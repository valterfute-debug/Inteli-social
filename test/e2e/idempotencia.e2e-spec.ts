import { randomUUID } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Issue #3, P0-3: a fila offline do PWA reenvia quando a resposta se perde. Mesma chave e
 * mesmo conteúdo devolvem o recurso original sem nova escrita; conteúdo diferente, 409;
 * requisições simultâneas com a mesma chave produzem um único registro.
 */
describe('Idempotência (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let ana: UsuarioTeste;
  let beto: UsuarioTeste;
  let catalogo: {
    especieId: string;
    unidadeId: string;
    localizacaoId: string;
    responsavelId: string;
  };
  let unidadeCcpa: { unidadeId: string; localizacaoId: string };

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

  function cadastrar(quem: UsuarioTeste, chave: string | null, corpo: object) {
    const requisicao = http().post('/api/v1/animals').set('Authorization', quem.autorizacao);
    if (chave) requisicao.set('Idempotency-Key', chave);
    return requisicao.send(corpo);
  }

  const contarAnimais = () => ambiente.prisma.animal.count();

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    const { prisma } = ambiente;
    const casAdote = await ambiente.idUnidade('CasAdote');
    const ccpa = await ambiente.idUnidade('CCPA');
    catalogo = {
      especieId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
      unidadeId: casAdote,
      localizacaoId: (
        await prisma.location.findUniqueOrThrow({
          where: { unitId_name: { unitId: casAdote, name: 'Canil' } },
        })
      ).id,
      responsavelId: (await prisma.responsible.findFirstOrThrow()).id,
    };
    unidadeCcpa = {
      unidadeId: ccpa,
      localizacaoId: (
        await prisma.location.findUniqueOrThrow({
          where: { unitId_name: { unitId: ccpa, name: 'Geral' } },
        })
      ).id,
    };
    ana = await ambiente.usuario('ana', PapelUsuario.ADMIN);
    beto = await ambiente.usuario('beto', PapelUsuario.ADMIN);
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  async function admissao(quem: UsuarioTeste, extra: object = {}) {
    return {
      nome: 'Luna',
      especieId: catalogo.especieId,
      unidadeId: catalogo.unidadeId,
      localizacaoId: catalogo.localizacaoId,
      responsavelId: catalogo.responsavelId,
      frente: 'CASADOTE',
      fotoEntradaId: await fotoConfirmada(quem),
      ...extra,
    };
  }

  it('exige Idempotency-Key no cadastro de animal', async () => {
    const resposta = await cadastrar(ana, null, await admissao(ana)).expect(400);
    expect(resposta.body.mensagem).toContain('Idempotency-Key');
  });

  it('resposta perdida depois do commit: o reenvio devolve o mesmo animal, sem duplicar', async () => {
    const corpo = await admissao(ana);
    const chave = randomUUID();
    const antes = await contarAnimais();

    const primeira = await cadastrar(ana, chave, corpo).expect(201);
    // O app não recebeu a primeira resposta e reenvia exatamente o mesmo cadastro.
    const reenvio = await cadastrar(ana, chave, corpo).expect(200);

    expect(reenvio.body.id).toBe(primeira.body.id);
    expect(reenvio.headers['idempotent-replayed']).toBe('true');
    expect(await contarAnimais()).toBe(antes + 1);
  });

  it('mesma chave com conteúdo diferente: 409 e nada gravado', async () => {
    const corpo = await admissao(ana);
    const chave = randomUUID();
    await cadastrar(ana, chave, corpo).expect(201);
    const antes = await contarAnimais();

    await cadastrar(ana, chave, { ...corpo, nome: 'Outro nome' }).expect(409);

    expect(await contarAnimais()).toBe(antes);
  });

  it('requisições simultâneas com a mesma chave criam um único animal', async () => {
    const corpo = await admissao(ana);
    const chave = randomUUID();
    const antes = await contarAnimais();

    const respostas = await Promise.all(
      Array.from({ length: 5 }, () => cadastrar(ana, chave, corpo)),
    );

    const status = respostas.map((r) => r.status).sort();
    expect(status.filter((s) => s === 201)).toHaveLength(1);
    expect(status.every((s) => s === 200 || s === 201)).toBe(true);
    expect(new Set(respostas.map((r) => r.body.id)).size).toBe(1);
    expect(await contarAnimais()).toBe(antes + 1);
  });

  it('o reenvio não esbarra nas próprias validações (microchip já cadastrado pela 1ª vez)', async () => {
    const corpo = await admissao(ana, {
      frente: 'CCPA',
      ...unidadeCcpa,
      microchip: '981000123456789',
      sexo: 'FEMEA',
      idadeAproximadaMeses: 12,
      pesoKg: 8.5,
      porte: 'PEQUENO',
    });
    const chave = randomUUID();

    const primeira = await cadastrar(ana, chave, corpo).expect(201);
    const reenvio = await cadastrar(ana, chave, corpo).expect(200);
    expect(reenvio.body.id).toBe(primeira.body.id);

    // Já um cadastro NOVO com o mesmo microchip continua barrado.
    await cadastrar(ana, randomUUID(), {
      ...corpo,
      fotoEntradaId: await fotoConfirmada(ana),
    }).expect(409);
  });

  it('cadastros simultâneos com o mesmo microchip (chaves diferentes): só um passa, o banco barra o resto', async () => {
    const extra = {
      frente: 'CCPA',
      ...unidadeCcpa,
      microchip: '981000999000111',
      sexo: 'MACHO',
      idadeAproximadaMeses: 6,
      pesoKg: 4,
      porte: 'PEQUENO',
    };
    const corpos = await Promise.all(Array.from({ length: 4 }, () => admissao(ana, extra)));
    const respostas = await Promise.all(corpos.map((corpo) => cadastrar(ana, randomUUID(), corpo)));
    expect(respostas.filter((r) => r.status === 201)).toHaveLength(1);
    expect(respostas.filter((r) => r.status === 409)).toHaveLength(3);
    expect(
      await ambiente.prisma.animal.count({
        where: { microchip: '981000999000111', deletedAt: null },
      }),
    ).toBe(1);
  });

  it('chaves são por usuário: a mesma chave de outra pessoa é outra operação', async () => {
    const chave = randomUUID();
    const daAna = await cadastrar(ana, chave, await admissao(ana)).expect(201);
    const doBeto = await cadastrar(beto, chave, await admissao(beto)).expect(201);
    expect(doBeto.body.id).not.toBe(daAna.body.id);
  });

  it('evento de saúde reenviado com a mesma chave não duplica a vacina', async () => {
    const animal = await cadastrar(ana, randomUUID(), await admissao(ana)).expect(201);
    const chave = randomUUID();
    const vacina = { tipo: 'VACINA', descricao: 'V10', data: '2026-10-01' };
    const rota = `/api/v1/animals/${animal.body.id}/health-events`;

    const primeira = await http()
      .post(rota)
      .set('Authorization', ana.autorizacao)
      .set('Idempotency-Key', chave)
      .send(vacina)
      .expect(201);
    const reenvio = await http()
      .post(rota)
      .set('Authorization', ana.autorizacao)
      .set('Idempotency-Key', chave)
      .send(vacina)
      .expect(200);

    expect(reenvio.body.id).toBe(primeira.body.id);
    expect(await ambiente.prisma.healthEvent.count({ where: { animalId: animal.body.id } })).toBe(
      1,
    );
  });

  it('foto: reuso da chave com outro conteúdo é recusado (409)', async () => {
    const chave = randomUUID();
    await http()
      .post('/api/v1/fotos')
      .set('Authorization', ana.autorizacao)
      .set('Idempotency-Key', chave)
      .send({ id: randomUUID(), tipoMidia: 'image/jpeg', tamanhoBytes: 1000 })
      .expect(201);
    await http()
      .post('/api/v1/fotos')
      .set('Authorization', ana.autorizacao)
      .set('Idempotency-Key', chave)
      .send({ id: randomUUID(), tipoMidia: 'image/jpeg', tamanhoBytes: 1000 })
      .expect(409);
  });
});
