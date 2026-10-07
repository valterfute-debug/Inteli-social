import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ambientePostgres,
  BancoBackup,
  contarTabelas,
  copiarStorage,
  ExecutarProcesso,
  executarPg,
  filtrarTocRestore,
  identificarOrigem,
  integridadeAuth,
  LIMITE_BACKUP_BYTES,
  ManifestoBackup,
  ObjetoStorage,
  serializarManifesto,
  sha256,
  validarDestinoRestore,
  validarManifesto,
  verificarArquivos,
  verificarBancoRestaurado,
  verificarDestinoVazio,
} from './backup-core';

const dbLocal =
  'postgresql://postgres:senha-ficticia@127.0.0.1:5432/ampara_restore_0123456789abcdef';
const origem = identificarOrigem('https://teste.supabase.invalid', 'fotos-animais');
const objeto: ObjetoStorage = {
  id: 'id-sintetico',
  caminho: 'foto.jpg',
  atualizadoEm: '2026-10-07T00:00:00.000Z',
  tamanhoBytes: 3,
  tipoMidia: 'image/jpeg',
};
function manifesto(): ManifestoBackup {
  return {
    versao: 2,
    criadoEm: '2026-10-07T00:00:00.000Z',
    origem,
    backendSha: 'a'.repeat(40),
    banco: {
      arquivo: 'banco.dump',
      sha256: sha256('db'),
      tamanhoBytes: 2,
      esquemas: ['public', 'auth'],
    },
    tabelas: [
      { esquema: 'auth', tabela: 'users', quantidade: 1 },
      { esquema: 'public', tabela: 'Usuario', quantidade: 1 },
    ],
    authUsuariosSha256: sha256(
      JSON.stringify([{ id: 'usuario-teste', registro: { encrypted_password: 'hash-ficticio' } }]),
    ),
    usuariosSemAuth: 0,
    roles: [],
    rolesPoliticas: [],
    extensoes: [],
    bucket: {
      id: 'fotos-animais',
      public: false,
      file_size_limit: 5000000,
      allowed_mime_types: ['image/jpeg'],
    },
    objetos: [],
    totais: { arquivos: 0, bytes: 2, baixados: 0, reutilizados: 0 },
  };
}
function banco(handler: (sql: string) => unknown): BancoBackup {
  return {
    $queryRawUnsafe: jest.fn(async (sql: string) => handler(sql)) as BancoBackup['$queryRawUnsafe'],
    $executeRawUnsafe: jest.fn(async () => 0),
  };
}
function bancoValido(
  overrides: {
    orphan?: bigint;
    fk?: bigint;
    photo?: unknown;
    users?: unknown;
    count?: bigint;
  } = {},
): BancoBackup {
  return banco((sql) => {
    if (sql.includes('c.relkind'))
      return [
        { esquema: 'auth', tabela: 'users' },
        { esquema: 'public', tabela: 'Usuario' },
      ];
    if (sql.includes('to_jsonb'))
      return (
        overrides.users ?? [
          { id: 'usuario-teste', registro: { encrypted_password: 'hash-ficticio' } },
        ]
      );
    if (sql.includes('LEFT JOIN auth.users')) return [{ quantidade: overrides.orphan ?? 0n }];
    if (sql.includes('pg_constraint')) return [{ quantidade: overrides.fk ?? 0n }];
    if (sql.includes('fotoEntradaId')) return overrides.photo ?? [];
    if (sql.includes('count(*)')) return [{ quantidade: overrides.count ?? 1n }];
    throw new Error('Consulta não reconhecida no teste');
  });
}
describe('backup recuperável', () => {
  const temporarias: string[] = [];
  function pasta() {
    const p = mkdtempSync(join(tmpdir(), 'ampara-backup-test-'));
    temporarias.push(p);
    return p;
  }
  afterAll(() => {
    for (const p of temporarias) {
      if (
        !resolve(p).startsWith(resolve(tmpdir()) + '\\ampara-backup-test-') &&
        !resolve(p).startsWith(resolve(tmpdir()) + '/ampara-backup-test-')
      )
        throw new Error('Destino temporário inesperado');
      rmSync(p, { recursive: true, force: true });
    }
  });
  it('separa credenciais de argv e sanitiza falhas do processo', () => {
    const exec = jest.fn(() => Buffer.from('')) as unknown as ExecutarProcesso;
    executarPg('pg_dump', ['--format=custom'], dbLocal, exec);
    const [tool, args, options] = (exec as jest.Mock).mock.calls[0];
    expect(tool).toBe('pg_dump');
    expect(args).toEqual(['--format=custom']);
    expect(JSON.stringify(args)).not.toContain('senha-ficticia');
    expect(options.env.PGPASSWORD).toBe('senha-ficticia');
    expect(options.stdio).toBe('pipe');
    expect(options.env).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY');
    const fail = jest.fn(() => {
      throw new Error(`Command failed: ${dbLocal}`);
    }) as unknown as ExecutarProcesso;
    expect(() => executarPg('pg_dump', [], dbLocal, fail)).toThrow('Ferramenta PostgreSQL falhou');
    try {
      executarPg('pg_dump', [], dbLocal, fail);
    } catch (error) {
      expect((error as Error).message).not.toContain('senha-ficticia');
    }
  });
  it('recusa nuvem, URL ambígua, banco não descartável e transaction pooler', () => {
    expect(validarDestinoRestore(dbLocal)).toBe('ampara_restore_0123456789abcdef');
    expect(() =>
      validarDestinoRestore(dbLocal.replace('127.0.0.1', 'db.supabase.invalid')),
    ).toThrow();
    expect(() =>
      validarDestinoRestore(dbLocal.replace('127.0.0.1', '127.0.0.1.evil.invalid')),
    ).toThrow();
    expect(() =>
      validarDestinoRestore(dbLocal.replace('ampara_restore_0123456789abcdef', 'postgres')),
    ).toThrow();
    expect(() => ambientePostgres(dbLocal.replace(':5432/', ':6543/'))).toThrow(
      'transaction pooler',
    );
  });
  it('seleção do restore ignora apenas CREATE SCHEMA public, preservando Auth, dados e constraints', () => {
    const entries = [
      '; Archive created at synthetic date',
      '6; 2615 2200 SCHEMA - public postgres',
      '7; 2615 12345 SCHEMA - auth postgres',
      '200; 1259 30000 TABLE public Usuario postgres',
      '201; 0 30000 TABLE DATA public Usuario postgres',
      '202; 2606 30010 FK CONSTRAINT auth identities identities_user_id_fkey postgres',
    ];
    const selection = filtrarTocRestore(entries.join('\n'));
    expect(selection).not.toContain(entries[1]);
    for (const entry of [entries[0], ...entries.slice(2)]) expect(selection).toContain(entry);
  });
  it('só aceita destino realmente local e vazio, antes de qualquer alteração', async () => {
    await expect(
      verificarDestinoVazio(
        banco((sql) =>
          sql.includes('inet_server_addr') ? [{ local: true }] : [{ quantidade: 0n }],
        ),
      ),
    ).resolves.toBeUndefined();
    await expect(
      verificarDestinoVazio(
        banco((sql) =>
          sql.includes('inet_server_addr') ? [{ local: true }] : [{ quantidade: 1n }],
        ),
      ),
    ).rejects.toThrow('vazio');
    await expect(
      verificarDestinoVazio(
        banco((sql) =>
          sql.includes('inet_server_addr') ? [{ local: false }] : [{ quantidade: 0n }],
        ),
      ),
    ).rejects.toThrow('local');
    await expect(verificarDestinoVazio(banco(() => []))).rejects.toThrow();
  });
  it('contagens exigem Auth e Usuario e jamais convertem query inválida em zero', async () => {
    await expect(contarTabelas(bancoValido())).resolves.toEqual(manifesto().tabelas);
    await expect(contarTabelas(banco(() => []))).rejects.toThrow('auth.users');
    await expect(
      contarTabelas(
        banco((sql) =>
          sql.includes('c.relkind')
            ? [
                { esquema: 'auth', tabela: 'users' },
                { esquema: 'public', tabela: 'Usuario' },
              ]
            : [{ quantidade: 'erro' }],
        ),
      ),
    ).rejects.toThrow('Contagem');
    await expect(
      contarTabelas(
        banco(() => {
          throw new Error('consulta falhou');
        }),
      ),
    ).rejects.toThrow('consulta falhou');
  });
  it('Auth preserva dados/hash de senha e vincula UUID sem guardar credenciais em logs', async () => {
    const valid = await integridadeAuth(bancoValido());
    expect(valid.semAuth).toBe(0);
    expect(valid.sha256).toBe(manifesto().authUsuariosSha256);
    const changed = await integridadeAuth(
      bancoValido({
        users: [{ id: 'usuario-teste', registro: { encrypted_password: 'outro-hash' } }],
      }),
    );
    expect(changed.sha256).not.toBe(valid.sha256);
    expect((await integridadeAuth(bancoValido({ orphan: 1n }))).semAuth).toBe(1);
  });
  it('copia fotos com hash e caminho local seguro mesmo se nome remoto contiver ../', async () => {
    const dest = pasta();
    const result = await copiarStorage({
      pasta: dest,
      origem,
      objetos: [{ ...objeto, caminho: '../../foto.jpg' }],
      bytesBanco: 2,
      baixar: async () => Buffer.from('jpg'),
    });
    expect(result.baixados).toBe(1);
    expect(result.reutilizados).toBe(0);
    expect(result.bytes).toBe(5);
    expect(result.objetos[0].arquivo).toMatch(/^storage\/[a-f0-9]{64}\.bin$/);
    expect(readFileSync(join(dest, result.objetos[0].arquivo)).toString()).toBe('jpg');
    expect(result.objetos[0].sha256).toBe(sha256('jpg'));
  });
  it('incremental só reutiliza mesma origem/ID/versão e SHA íntegro', async () => {
    const prev = pasta();
    const first = await copiarStorage({
      pasta: prev,
      origem,
      objetos: [objeto],
      bytesBanco: 2,
      baixar: async () => Buffer.from('jpg'),
    });
    const m = {
      ...manifesto(),
      objetos: first.objetos,
      totais: { arquivos: 1, bytes: 5, baixados: 1, reutilizados: 0 },
    };
    const download = jest.fn(async () => Buffer.from('jpg'));
    const second = await copiarStorage({
      pasta: pasta(),
      origem,
      objetos: [objeto],
      bytesBanco: 2,
      anterior: { pasta: prev, manifesto: m },
      baixar: download,
    });
    expect(second.reutilizados).toBe(1);
    expect(download).not.toHaveBeenCalled();
    writeFileSync(join(prev, first.objetos[0].arquivo), 'bad');
    const third = await copiarStorage({
      pasta: pasta(),
      origem,
      objetos: [objeto],
      bytesBanco: 2,
      anterior: { pasta: prev, manifesto: m },
      baixar: download,
    });
    expect(third.baixados).toBe(1);
    expect(download).toHaveBeenCalledTimes(1);
    const fourth = await copiarStorage({
      pasta: pasta(),
      origem,
      objetos: [{ ...objeto, id: 'nova-versao' }],
      bytesBanco: 2,
      anterior: { pasta: prev, manifesto: m },
      baixar: download,
    });
    expect(fourth.reutilizados).toBe(0);
  });
  it('limite é aplicado antes do download e tamanho divergente falha', async () => {
    const baixar = jest.fn(async () => Buffer.from('jpg'));
    await expect(
      copiarStorage({
        pasta: pasta(),
        origem,
        objetos: [objeto],
        bytesBanco: LIMITE_BACKUP_BYTES,
        baixar,
      }),
    ).rejects.toThrow('teto');
    expect(baixar).not.toHaveBeenCalled();
    await expect(
      copiarStorage({
        pasta: pasta(),
        origem,
        objetos: [objeto],
        bytesBanco: 2,
        baixar: async () => Buffer.from('mudou'),
      }),
    ).rejects.toThrow('mudou');
  });
  it('manifesto v2 e SHA do dump/fotos são obrigatórios', () => {
    const m = manifesto();
    const dest = pasta();
    writeFileSync(join(dest, 'banco.dump'), 'db');
    expect(validarManifesto(m)).toBe(m);
    expect(() => verificarArquivos(dest, m)).not.toThrow();
    writeFileSync(join(dest, 'banco.dump'), 'corrompido');
    expect(() => verificarArquivos(dest, m)).toThrow('Integridade');
    expect(() => validarManifesto({ ...m, versao: 1 })).toThrow();
    expect(() => validarManifesto({ ...m, usuariosSemAuth: 1 })).toThrow();
    expect(() => validarManifesto({ ...m, totais: { ...m.totais, bytes: 3 } })).toThrow();
    expect(() => validarManifesto({ ...m, tabelas: [m.tabelas[0], m.tabelas[0]] })).toThrow();
    expect(() =>
      validarManifesto({
        ...m,
        objetos: [{ ...objeto, sha256: sha256('jpg'), arquivo: '../segredo' }],
      }),
    ).toThrow();
    mkdirSync(join(dest, 'storage'));
  });
  it('mede o manifesto real, sem confiar apenas na reserva estimada de 1 MiB', () => {
    const m = manifesto();
    expect(serializarManifesto(m)).toBe(JSON.stringify(m, null, 2));
    m.objetos = Array.from({ length: 10000 }, (_, index) => {
      const caminho = `entrada/foto-${index}.jpg`;
      return {
        ...objeto,
        id: `foto-${index}`,
        caminho,
        arquivo: `storage/${sha256(caminho)}.bin`,
        sha256: sha256('synthetic-only'),
        tamanhoBytes: 1024,
      };
    });
    m.banco.tamanhoBytes = LIMITE_BACKUP_BYTES - 1024 * 1024 - 10000 * 1024;
    m.totais = {
      arquivos: 10000,
      bytes: LIMITE_BACKUP_BYTES - 1024 * 1024,
      baixados: 10000,
      reutilizados: 0,
    };
    expect(validarManifesto(m)).toBe(m); // Passes the previous estimated-size check.
    expect(Buffer.byteLength(JSON.stringify(m, null, 2), 'utf8')).toBeGreaterThan(1024 * 1024);
    expect(() => serializarManifesto(m)).toThrow('teto descompactado');
  });
  it('restore confere contagens, UUID/hash Auth, FKs e existência da foto', async () => {
    await expect(verificarBancoRestaurado(bancoValido(), manifesto())).resolves.toBeUndefined();
    await expect(verificarBancoRestaurado(bancoValido({ count: 2n }), manifesto())).rejects.toThrow(
      'Contagens',
    );
    await expect(
      verificarBancoRestaurado(bancoValido({ orphan: 1n }), manifesto()),
    ).rejects.toThrow('UUID');
    await expect(verificarBancoRestaurado(bancoValido({ fk: 1n }), manifesto())).rejects.toThrow(
      'estrangeiras',
    );
    await expect(
      verificarBancoRestaurado(
        bancoValido({ photo: [{ caminho: 'ausente.jpg', situacao: 'CONFIRMADA' }] }),
        manifesto(),
      ),
    ).rejects.toThrow('foto');
    const m = {
      ...manifesto(),
      objetos: [
        { ...objeto, arquivo: `storage/${sha256(objeto.caminho)}.bin`, sha256: sha256('jpg') },
      ],
    };
    await expect(
      verificarBancoRestaurado(
        bancoValido({ photo: [{ caminho: objeto.caminho, situacao: 'CONFIRMADA' }] }),
        m,
      ),
    ).resolves.toBeUndefined();
    await expect(
      verificarBancoRestaurado(
        bancoValido({ photo: [{ caminho: objeto.caminho, situacao: 'PENDENTE' }] }),
        m,
      ),
    ).rejects.toThrow('foto');
  });
});
