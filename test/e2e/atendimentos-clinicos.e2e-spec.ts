import { randomUUID } from 'node:crypto';
import { PapelUsuario } from '@prisma/client';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { UsuarioTeste, criarAmbienteE2E } from './app-e2e';

/**
 * Prontuário clínico por atendimento: vínculo com o animal, admissão única, histórico
 * preservado, escopo por unidade e idempotência, com banco real.
 */
describe('Atendimentos clínicos (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let admin: UsuarioTeste;
  let opCed: UsuarioTeste;
  let animalId: string;
  let outroAnimalId: string;
  let responsavelId: string;

  const http = () => request(ambiente.app.getHttpServer());
  const rota = (id = animalId) => `/api/v1/animals/${id}/atendimentos`;

  async function criarAnimal(publicId: string) {
    const { prisma } = ambiente;
    const casAdote = await ambiente.idUnidade('CasAdote');
    const animal = await prisma.animal.create({
      data: {
        id: randomUUID(),
        publicId,
        name: publicId,
        speciesId: (await prisma.species.findUniqueOrThrow({ where: { name: 'Cão' } })).id,
        unitId: casAdote,
        locationId: (
          await prisma.location.findUniqueOrThrow({
            where: { unitId_name: { unitId: casAdote, name: 'Canil' } },
          })
        ).id,
        responsibleId: responsavelId,
        front: 'CASADOTE',
      },
    });
    return animal.id;
  }

  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
    responsavelId = (await ambiente.prisma.responsible.findFirstOrThrow()).id;
    animalId = await criarAnimal('AT-0001');
    outroAnimalId = await criarAnimal('AT-0002');
    admin = await ambiente.usuario('admin-atendimentos', PapelUsuario.ADMIN);
    opCed = await ambiente.usuario('op-ced-atendimentos', PapelUsuario.OPERADOR, ['CED']);
  });

  afterAll(async () => {
    await ambiente.encerrar();
  });

  it('registra a admissão ligada ao animal, com animal e responsável consultáveis', async () => {
    const chave = randomUUID();
    const corpo = { anamnese: 'Resgatado na rua', exameFisico: 'Temperatura 38,5' };
    const criado = await http()
      .post(rota())
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', chave)
      .send(corpo)
      .expect(201);
    expect(criado.body).toMatchObject({
      animalId,
      tipo: 'ADMISSAO',
      anamnese: 'Resgatado na rua',
      animal: { identificadorPublico: 'AT-0001' },
      responsavel: { id: responsavelId },
      versao: 1,
    });

    // Reenvio com a mesma chave: mesmo atendimento, sem duplicar.
    const reenvio = await http()
      .post(rota())
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', chave)
      .send(corpo)
      .expect(200);
    expect(reenvio.body.id).toBe(criado.body.id);
    expect(await ambiente.prisma.atendimentoClinico.count({ where: { animalId } })).toBe(1);
  });

  it('recusa uma segunda admissão, mas aceita acompanhamentos sem alterar o histórico', async () => {
    await http()
      .post(rota())
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({ tipo: 'ADMISSAO' })
      .expect(409);

    const acompanhamento = await http()
      .post(rota())
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({ tratamento: 'Vermífugo' })
      .expect(201);
    expect(acompanhamento.body.tipo).toBe('ACOMPANHAMENTO');

    const lista = await http().get(rota()).set('Authorization', admin.autorizacao).expect(200);
    expect(lista.body.total).toBe(2);
    const admissao = lista.body.itens.find((item: { tipo: string }) => item.tipo === 'ADMISSAO');
    expect(admissao).toMatchObject({ anamnese: 'Resgatado na rua', tratamento: null });
  });

  it('o histórico sobrevive à troca de responsável no cadastro do animal', async () => {
    const { prisma } = ambiente;
    const novo = await prisma.responsible.create({ data: { name: 'Novo tutor' } });
    await prisma.animal.update({ where: { id: animalId }, data: { responsibleId: novo.id } });

    const lista = await http().get(rota()).set('Authorization', admin.autorizacao).expect(200);
    expect(
      lista.body.itens.every(
        (item: { responsavel: { id: string } }) => item.responsavel.id === responsavelId,
      ),
    ).toBe(true);

    const depois = await http()
      .post(rota())
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({ anamnese: 'Retorno' })
      .expect(201);
    expect(depois.body.responsavel.id).toBe(novo.id);
  });

  it('atualiza com controle de versão', async () => {
    const [primeiro] = (
      await http().get(rota()).set('Authorization', admin.autorizacao).expect(200)
    ).body.itens.filter((item: { tipo: string }) => item.tipo === 'ADMISSAO');

    const atualizado = await http()
      .patch(`${rota()}/${primeiro.id}`)
      .set('Authorization', admin.autorizacao)
      .send({ versao: 1, examesComplementares: 'Hemograma normal' })
      .expect(200);
    expect(atualizado.body).toMatchObject({
      versao: 2,
      examesComplementares: 'Hemograma normal',
      anamnese: 'Resgatado na rua',
    });

    await http()
      .patch(`${rota()}/${primeiro.id}`)
      .set('Authorization', admin.autorizacao)
      .send({ versao: 1, tratamento: 'x' })
      .expect(409);
  });

  it('não encontra o atendimento por outro animal e não cria para animal inexistente', async () => {
    const [primeiro] = (
      await http().get(rota()).set('Authorization', admin.autorizacao).expect(200)
    ).body.itens;
    await http()
      .get(`${rota(outroAnimalId)}/${primeiro.id}`)
      .set('Authorization', admin.autorizacao)
      .expect(404);
    await http()
      .post(rota(randomUUID()))
      .set('Authorization', admin.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(404);
  });

  it('respeita o escopo por unidade: operador do CED não vê animal do CasAdote', async () => {
    await http().get(rota()).set('Authorization', opCed.autorizacao).expect(403);
    await http()
      .post(rota())
      .set('Authorization', opCed.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(403);
  });

  it('exige Idempotency-Key na criação', async () => {
    await http().post(rota()).set('Authorization', admin.autorizacao).send({}).expect(400);
  });

  describe('concorrência e idempotência', () => {
    it('admissões simultâneas (chaves diferentes): nunca há duas admissões ativas', async () => {
      const novoAnimal = await criarAnimal('AT-0010');
      const respostas = await Promise.all(
        [randomUUID(), randomUUID(), randomUUID()].map((chave) =>
          http()
            .post(rota(novoAnimal))
            .set('Authorization', admin.autorizacao)
            .set('Idempotency-Key', chave)
            .send({ anamnese: 'simultâneo' }),
        ),
      );

      expect(respostas.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(respostas.some((r) => r.status === 201)).toBe(true);
      const admissoes = await ambiente.prisma.atendimentoClinico.count({
        where: { animalId: novoAnimal, tipo: 'ADMISSAO', deletedAt: null },
      });
      expect(admissoes).toBe(1);
    });

    it('mesma chave enviada em paralelo cria um único atendimento', async () => {
      const novoAnimal = await criarAnimal('AT-0011');
      const chave = randomUUID();
      const respostas = await Promise.all(
        [1, 2, 3].map(() =>
          http()
            .post(rota(novoAnimal))
            .set('Authorization', admin.autorizacao)
            .set('Idempotency-Key', chave)
            .send({ tratamento: 'mesmo corpo' }),
        ),
      );

      expect(respostas.every((r) => [200, 201, 409].includes(r.status))).toBe(true);
      expect(
        await ambiente.prisma.atendimentoClinico.count({ where: { animalId: novoAnimal } }),
      ).toBe(1);
    });

    it('dois PATCH simultâneos com a mesma versão: só um vence', async () => {
      const novoAnimal = await criarAnimal('AT-0012');
      const criado = await http()
        .post(rota(novoAnimal))
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', randomUUID())
        .send({})
        .expect(201);

      const respostas = await Promise.all(
        ['A', 'B'].map((texto) =>
          http()
            .patch(`${rota(novoAnimal)}/${criado.body.id}`)
            .set('Authorization', admin.autorizacao)
            .send({ versao: 1, tratamento: `edição ${texto}` }),
        ),
      );

      expect(respostas.map((r) => r.status).sort()).toEqual([200, 409]);
      const final = await http()
        .get(`${rota(novoAnimal)}/${criado.body.id}`)
        .set('Authorization', admin.autorizacao)
        .expect(200);
      expect(final.body.versao).toBe(2);
    });

    it('a mesma chave usada em outro animal é recusada (409) e nada é gravado nele', async () => {
      const a = await criarAnimal('AT-0013');
      const b = await criarAnimal('AT-0014');
      const chave = randomUUID();
      await http()
        .post(rota(a))
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', chave)
        .send({ anamnese: 'x' })
        .expect(201);

      await http()
        .post(rota(b))
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', chave)
        .send({ anamnese: 'x' })
        .expect(409);
      expect(await ambiente.prisma.atendimentoClinico.count({ where: { animalId: b } })).toBe(0);
    });

    it('a mesma chave com outro conteúdo é recusada (409)', async () => {
      const novoAnimal = await criarAnimal('AT-0015');
      const chave = randomUUID();
      await http()
        .post(rota(novoAnimal))
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', chave)
        .send({ anamnese: 'um' })
        .expect(201);

      await http()
        .post(rota(novoAnimal))
        .set('Authorization', admin.autorizacao)
        .set('Idempotency-Key', chave)
        .send({ anamnese: 'dois' })
        .expect(409);
    });
  });
});
