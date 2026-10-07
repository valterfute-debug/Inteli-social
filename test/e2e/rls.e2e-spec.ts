import { criarAmbienteE2E } from './app-e2e';

/** Prisma usa a role privilegiada. Nenhuma tabela pode oferecer acesso direto público. */
describe('Proteção das tabelas públicas (e2e, banco real)', () => {
  let ambiente: Awaited<ReturnType<typeof criarAmbienteE2E>>;
  beforeAll(async () => {
    ambiente = await criarAmbienteE2E();
  });
  afterAll(async () => {
    await ambiente.encerrar();
  });

  it('todas as tabelas da aplicação e metadados de migration têm RLS habilitada', async () => {
    const tabelas = await ambiente.prisma.$queryRaw<{ relname: string; relrowsecurity: boolean }[]>`
      SELECT c.relname::text AS relname, c.relrowsecurity FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'`;
    expect(tabelas.length).toBeGreaterThanOrEqual(14);
    expect(tabelas.every((tabela) => tabela.relrowsecurity)).toBe(true);
    expect(tabelas.map((tabela) => tabela.relname)).toContain('RemocaoArquivo');
  });

  it('PUBLIC não possui privilégios nas tabelas, e roles REST existentes também não', async () => {
    const publicos = await ambiente.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname::text AS relname FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) a
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND a.grantee = 0`;
    expect(publicos).toEqual([]);
    const privilegios = await ambiente.prisma.$queryRaw<
      { rolname: string; relname: string; permitido: boolean }[]
    >`
      SELECT r.rolname::text AS rolname, c.relname::text AS relname,
        has_table_privilege(r.oid, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS permitido
      FROM pg_roles r CROSS JOIN pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE r.rolname IN ('anon', 'authenticated') AND n.nspname = 'public' AND c.relkind = 'r'`;
    expect(privilegios.every((privilegio) => !privilegio.permitido)).toBe(true);
    // PostgreSQL local pode não ter as roles Supabase. Nesse caso a verificação
    // dessas duas roles deve ser repetida na homologação; PUBLIC/RLS são testados aqui.
  });
});
