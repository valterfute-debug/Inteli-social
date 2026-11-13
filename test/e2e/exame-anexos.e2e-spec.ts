import { validarAnexosNoBackup } from '../../src/database/backup-core';
import { randomUUID } from 'node:crypto';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { criarAmbienteE2E, storageSimulado, UsuarioTeste } from './app-e2e';
import { EXAME_TESTE } from '../exame-fisico-teste';

describe('Exame estruturado e anexos privados (HTTP + PostgreSQL)', () => {
  let env: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  let a: UsuarioTeste;
  let b: UsuarioTeste;
  let animalId: string;
  let legadoId: string;
  let recordId: string;
  const http = () => request(env.app.getHttpServer());
  const records = () => `/api/v1/animals/${animalId}/atendimentos`;
  const anexos = () => `${records()}/${recordId}/anexos`;
  const send = (body: object) =>
    http()
      .post(records())
      .set('Authorization', a.autorizacao)
      .set('Idempotency-Key', randomUUID())
      .send(body);
  const arquivo = (overrides: object = {}) => ({
    id: randomUUID(),
    nome: 'exame.jpg',
    tipoMidia: 'image/jpeg',
    tamanhoBytes: 1000,
    ...overrides,
  });
  const prepare = (body = arquivo(), user = a) =>
    http().post(anexos()).set('Authorization', user.autorizacao).send(body);
  const confirm = (id: string, user = a) =>
    http().post(`${anexos()}/${id}/confirmacao`).set('Authorization', user.autorizacao).send({});

  beforeAll(async () => {
    env = await criarAmbienteE2E();
    a = await env.usuario('clinica-a');
    b = await env.usuario('clinica-b');
    const animal = await env.prisma.animal.create({
      data: {
        id: randomUUID(),
        publicId: 'EXAME-SINTETICO',
        front: 'CASADOTE',
        speciesId: (await env.prisma.species.findFirstOrThrow()).id,
        responsibleId: (await env.prisma.responsible.findFirstOrThrow()).id,
        unitId: await env.idUnidade('CasAdote'),
      },
    });
    animalId = animal.id;
    const legado = await env.prisma.atendimentoClinico.create({
      data: {
        animalId,
        responsibleId: animal.responsibleId,
        tipo: 'ADMISSAO',
        criadoPorId: a.id,
        dataAtendimento: new Date(),
        exameFisico: 'Texto legado preservado',
      },
    });
    legadoId = legado.id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => env.encerrar());

  it('preserva leitura e edição de outras seções do legado sem inventar medidas', async () => {
    const r = await http()
      .patch(`${records()}/${legadoId}`)
      .set('Authorization', a.autorizacao)
      .send({ versao: 1, tratamento: 'Nota adicional' })
      .expect(200);
    expect(r.body).toMatchObject({
      exameFisico: 'Texto legado preservado',
      temperatura: null,
      versao: 2,
    });
  });

  it('recusa ausência de qualquer um dos seis parâmetros, espaços, tipos e números inválidos', async () => {
    await send({ tratamento: 'Incompleto' }).expect(400);
    for (const field of Object.keys(EXAME_TESTE)) {
      const body: Record<string, unknown> = { ...EXAME_TESTE };
      delete body[field];
      await send(body).expect(400);
    }
    for (const invalid of [
      { tpc: -1 },
      { temperatura: '38,5' },
      { mucosa: '   ' },
      { linfonodos: 'x'.repeat(501) },
      { frequenciaRespiratoria: 2.5 },
      { frequenciaCardiaca: 2147483648 },
    ])
      await send({ ...EXAME_TESTE, ...invalid }).expect(400);
  });

  it('persiste, recarrega e altera apenas um parâmetro usando o estado final e versão', async () => {
    const r = await send({ ...EXAME_TESTE, exameFisico: 'Observação preservada' }).expect(201);
    recordId = r.body.id;
    expect(r.body).toMatchObject(EXAME_TESTE);
    await http()
      .patch(`${records()}/${recordId}`)
      .set('Authorization', a.autorizacao)
      .send({ versao: 1, tpc: 1.5 })
      .expect(200);
    const saved = await http()
      .get(`${records()}/${recordId}`)
      .set('Authorization', b.autorizacao)
      .expect(200);
    expect(saved.body).toMatchObject({
      ...EXAME_TESTE,
      tpc: 1.5,
      versao: 2,
      exameFisico: 'Observação preservada',
    });
    await http()
      .patch(`${records()}/${recordId}`)
      .set('Authorization', a.autorizacao)
      .send({ versao: 2, mucosa: null })
      .expect(400);
    await http()
      .patch(`${records()}/${recordId}`)
      .set('Authorization', a.autorizacao)
      .send({ versao: 1, tpc: 3 })
      .expect(409);
  });

  it('aceita zero como medida e não impõe faixas de normalidade clínica', async () => {
    await send({ ...EXAME_TESTE, frequenciaCardiaca: 0, frequenciaRespiratoria: 0, tpc: 0 }).expect(
      201,
    );
  });

  it('valida nome, extensão, tamanho e bucket privado antes de emitir link', async () => {
    for (const invalid of [
      { nome: '../exame.jpg' },
      { nome: 'exame.exe' },
      { tamanhoBytes: 0 },
      { tamanhoBytes: 20 * 1024 * 1024 + 1 },
      { tipoMidia: 'text/html' },
    ])
      await prepare(arquivo(invalid)).expect(400);
    jest.spyOn(storageSimulado, 'situacaoBucket').mockResolvedValue('publico' as 'privado');
    await prepare().expect(409);
  });

  it('prepara com id estável, recusa reuso divergente e só autor confirma', async () => {
    const file = arquivo();
    const r = await prepare(file).expect(201);
    expect(r.body.urlEnvio).toContain(`/exames/${recordId}/${file.id}.jpg`);
    expect(r.body).not.toHaveProperty('caminhoArmazenamento');
    await prepare(file).expect(201);
    expect(await env.prisma.anexoClinico.count({ where: { id: file.id } })).toBe(1);
    await prepare({ ...file, nome: 'outro.jpg' }).expect(409);
    await prepare(file, b).expect(403);
    await confirm(file.id, b).expect(403);
    await confirm(file.id).expect(201);
    await confirm(file.id).expect(201);
    const list = await http().get(anexos()).set('Authorization', b.autorizacao).expect(200);
    expect(list.body.itens.some((x: { id: string }) => x.id === file.id)).toBe(true);
    const link = await http()
      .get(`${anexos()}/${file.id}/leitura`)
      .set('Authorization', b.autorizacao)
      .expect(200);
    expect(link.body.url).toContain('storage.invalid/leitura');
    expect(Date.parse(link.body.expiraEm)).toBeGreaterThan(Date.now());
    await http().get(`${anexos()}/${file.id}/leitura`).expect(401);
    await http().delete(`${anexos()}/${file.id}`).set('Authorization', a.autorizacao).expect(409);
  });

  it('recusa arquivo ausente, tipo/tamanho divergentes e assinatura falsa, sem confirmar', async () => {
    const file = arquivo();
    await prepare(file).expect(201);
    const meta = jest.spyOn(storageSimulado, 'obterMetadados');
    meta.mockResolvedValueOnce(null as never);
    await confirm(file.id).expect(409);
    meta.mockResolvedValueOnce({ tamanhoBytes: 999, tipoMidia: 'image/jpeg' });
    await confirm(file.id).expect(400);
    meta.mockResolvedValueOnce({ tamanhoBytes: 1000, tipoMidia: 'application/pdf' });
    await confirm(file.id).expect(400);
    jest.spyOn(storageSimulado, 'obterInicioArquivo').mockResolvedValueOnce(Buffer.from('<html>'));
    await confirm(file.id).expect(400);
    expect(
      (await env.prisma.anexoClinico.findUniqueOrThrow({ where: { id: file.id } })).confirmado,
    ).toBe(false);
    await http()
      .get(`${anexos()}/${file.id}/leitura`)
      .set('Authorization', a.autorizacao)
      .expect(409);
    await env.prisma.anexoClinico.update({
      where: { id: file.id },
      data: { expiraEm: new Date(0) },
    });
    await confirm(file.id).expect(409);
  });

  it('confirma imagem, PDF, DOC, DOCX e vídeos com tipo e assinatura correspondentes', async () => {
    const cases = [
      ['pdf', 'application/pdf', Buffer.from('%PDF-1.7')],
      ['doc', 'application/msword', Buffer.from([208, 207, 17, 224, 161, 177, 26, 225])],
      [
        'docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        Buffer.from([80, 75, 3, 4]),
      ],
      ['mp4', 'video/mp4', Buffer.from([0, 0, 0, 20, 102, 116, 121, 112])],
      ['webm', 'video/webm', Buffer.from([26, 69, 223, 163])],
    ] as const;
    for (const [ext, tipo, bytes] of cases) {
      const file = arquivo({ nome: `exame.${ext}`, tipoMidia: tipo });
      await prepare(file).expect(201);
      jest
        .spyOn(storageSimulado, 'obterMetadados')
        .mockResolvedValueOnce({ tamanhoBytes: 1000, tipoMidia: tipo });
      jest.spyOn(storageSimulado, 'obterInicioArquivo').mockResolvedValueOnce(bytes);
      await confirm(file.id).expect(201);
    }
  });

  it('não permite trocar o atendimento/animal de um anexo e não revela pendentes de outra conta', async () => {
    const file = arquivo();
    await prepare(file).expect(201);
    const list = await http().get(anexos()).set('Authorization', b.autorizacao).expect(200);
    expect(list.body.itens.some((x: { id: string }) => x.id === file.id)).toBe(false);
    await http()
      .get(`${records()}/${legadoId}/anexos/${file.id}/leitura`)
      .set('Authorization', a.autorizacao)
      .expect(404);
    await http()
      .get(`/api/v1/animals/${randomUUID()}/atendimentos/${recordId}/anexos`)
      .set('Authorization', a.autorizacao)
      .expect(404);
  });

  it('respeita limite de quantidade em concorrência e mantém descarte durável', async () => {
    const r = await send(EXAME_TESTE).expect(201);
    const previous = recordId;
    recordId = r.body.id;
    const results = await Promise.all(Array.from({ length: 12 }, () => prepare(arquivo())));
    expect(results.filter((r) => r.status === 201)).toHaveLength(10);
    expect(results.filter((r) => r.status === 400)).toHaveLength(2);
    const id = results.find((r) => r.status === 201)!.body.id;
    await http().delete(`${anexos()}/${id}`).set('Authorization', b.autorizacao).expect(403);
    await http().delete(`${anexos()}/${id}`).set('Authorization', a.autorizacao).expect(200);
    await http().delete(`${anexos()}/${id}`).set('Authorization', a.autorizacao).expect(200);
    expect((await env.prisma.anexoClinico.findUniqueOrThrow({ where: { id } })).cancelado).toBe(
      true,
    );
    expect(await env.prisma.remocaoArquivo.count({ where: { fotoId: id } })).toBe(1);
    await prepare(arquivo({ id })).expect(409);
    await prepare().expect(201);
    recordId = previous;
  });

  it('recusa conjuntos parciais no banco e verifica que todo anexo confirmado está no backup', async () => {
    await expect(
      env.prisma.atendimentoClinico.update({ where: { id: legadoId }, data: { tpc: 2 } }),
    ).rejects.toThrow();
    const paths = await env.prisma.anexoClinico.findMany({
      where: { confirmado: true, cancelado: false },
    });
    await expect(validarAnexosNoBackup(env.prisma, new Set())).rejects.toThrow(
      'Anexo clínico confirmado ausente',
    );
    await expect(
      validarAnexosNoBackup(env.prisma, new Set(paths.map((p) => p.caminhoArmazenamento))),
    ).resolves.toBeUndefined();
  });

  it('limita o total de bytes mesmo antes da confirmação dos uploads', async () => {
    const r = await send(EXAME_TESTE).expect(201);
    const previous = recordId;
    recordId = r.body.id;
    for (let i = 0; i < 5; i++)
      await prepare(arquivo({ tamanhoBytes: 20 * 1024 * 1024 })).expect(201);
    await prepare(arquivo({ tamanhoBytes: 1 })).expect(400);
    recordId = previous;
  });

  it('gera PDF com medidas e inventário de anexos confirmados, sem URLs temporárias', async () => {
    const r = await http()
      .get(`/api/v1/animals/${animalId}/prontuario`)
      .set('Authorization', a.autorizacao)
      .expect(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.body.subarray(0, 5).toString()).toBe('%PDF-');
    const audit = await http()
      .get('/api/v1/auditoria?entidade=AnexoClinico')
      .set('Authorization', a.autorizacao)
      .expect(200);
    expect(audit.body.total).toBeGreaterThan(0);
    expect(JSON.stringify(audit.body)).not.toContain('urlEnvio');
  });
});
