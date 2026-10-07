import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PapelUsuario, PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

/**
 * Libera (ou atualiza/desativa) uma conta do Supabase Auth na API.
 * A conta precisa existir antes em Authentication > Users no painel do Supabase.
 *
 *   npm run usuario:liberar -- --email ana@ampara.org --papel OPERADOR --unidade CasAdote --unidade CED
 *   npm run usuario:liberar -- --email coord@ampara.org --papel ADMIN
 *   npm run usuario:liberar -- --email ana@ampara.org --desativar
 *
 * Em produção (após o build): node dist/database/liberar-usuario.js ...
 */
export interface DadosLiberacao {
  id: string;
  email?: string | null;
  nome?: string | null;
  papel: PapelUsuario;
  /** Nomes das unidades (como no catálogo). Substituem os vínculos anteriores. */
  unidades: string[];
  ativo: boolean;
}

type ClienteLiberacao = Pick<PrismaClient, 'unit' | 'usuario' | 'usuarioUnidade' | '$transaction'>;

export async function liberarUsuario(prisma: ClienteLiberacao, dados: DadosLiberacao) {
  const unidades = await prisma.unit.findMany({
    where: { name: { in: dados.unidades }, deletedAt: null },
    select: { id: true, name: true },
  });
  const inexistentes = dados.unidades.filter((nome) => !unidades.some((u) => u.name === nome));
  if (inexistentes.length > 0) {
    throw new Error(`Unidade(s) não encontrada(s) no catálogo: ${inexistentes.join(', ')}`);
  }

  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.upsert({
      where: { id: dados.id },
      create: {
        id: dados.id,
        email: dados.email,
        nome: dados.nome,
        papel: dados.papel,
        ativo: dados.ativo,
      },
      update: {
        ...(dados.email !== undefined ? { email: dados.email } : {}),
        ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
        papel: dados.papel,
        ativo: dados.ativo,
      },
    });
    await tx.usuarioUnidade.deleteMany({ where: { usuarioId: dados.id } });
    if (unidades.length > 0) {
      await tx.usuarioUnidade.createMany({
        data: unidades.map((unidade) => ({ usuarioId: dados.id, unitId: unidade.id })),
      });
    }
    return { ...usuario, unidades: unidades.map((unidade) => unidade.name) };
  });
}

async function buscarIdNoSupabase(email: string): Promise<string | null> {
  const url = process.env.SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env');
  const supabase = createClient(url, chave, { auth: { persistSession: false } });
  const porPagina = 1000;
  for (let pagina = 1; ; pagina++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page: pagina,
      perPage: porPagina,
    });
    if (error) throw new Error(`Falha ao consultar usuários do Supabase: ${error.message}`);
    const encontrado = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (encontrado) return encontrado.id;
    if (data.users.length < porPagina) return null;
  }
}

async function executar() {
  const { values } = parseArgs({
    options: {
      email: { type: 'string' },
      id: { type: 'string' },
      nome: { type: 'string' },
      papel: { type: 'string', default: PapelUsuario.OPERADOR },
      unidade: { type: 'string', multiple: true, default: [] },
      desativar: { type: 'boolean', default: false },
    },
  });

  if (!values.email && !values.id)
    throw new Error('Informe --email (ou --id do usuário no Supabase)');
  const papel = values.papel as PapelUsuario;
  if (!Object.values(PapelUsuario).includes(papel)) {
    throw new Error(`--papel deve ser um de: ${Object.values(PapelUsuario).join(', ')}`);
  }

  const id = values.id ?? (await buscarIdNoSupabase(values.email!));
  if (!id) throw new Error(`Nenhuma conta com e-mail ${values.email} em Authentication > Users`);
  if (papel === PapelUsuario.OPERADOR && values.unidade.length === 0 && !values.desativar) {
    console.warn('Aviso: OPERADOR sem --unidade não verá nenhum animal.');
  }

  const prisma = new PrismaClient();
  try {
    const usuario = await liberarUsuario(prisma, {
      id,
      email: values.email,
      nome: values.nome,
      papel,
      unidades: values.unidade,
      ativo: !values.desativar,
    });
    console.log(
      `${usuario.ativo ? 'Liberado' : 'Desativado'}: ${usuario.email ?? usuario.id} | ${usuario.papel} | ` +
        `unidades: ${usuario.papel === PapelUsuario.ADMIN ? 'todas' : usuario.unidades.join(', ') || 'nenhuma'}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  executar().catch((erro: unknown) => {
    console.error((erro as Error).message);
    process.exitCode = 1;
  });
}
