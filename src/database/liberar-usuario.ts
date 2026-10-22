import 'dotenv/config';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';

/**
 * Libera (ou desativa) uma conta do Supabase Auth na API. Todas as contas liberadas têm as mesmas
 * permissões; não há papel nem vínculo com unidade. A conta precisa existir antes em
 * Authentication > Users no painel do Supabase.
 *
 *   npm run usuario:liberar -- --email ana@ampara.org
 *   npm run usuario:liberar -- --email ana@ampara.org --desativar
 *
 * Em produção (após o build): node dist/database/liberar-usuario.js ...
 */
export interface DadosLiberacao {
  id: string;
  email?: string | null;
  nome?: string | null;
  ativo: boolean;
}

type ClienteLiberacao = Pick<PrismaClient, 'usuario'>;

export async function liberarUsuario(prisma: ClienteLiberacao, dados: DadosLiberacao) {
  return prisma.usuario.upsert({
    where: { id: dados.id },
    create: { id: dados.id, email: dados.email, nome: dados.nome, ativo: dados.ativo },
    update: {
      ...(dados.email !== undefined ? { email: dados.email } : {}),
      ...(dados.nome !== undefined ? { nome: dados.nome } : {}),
      ativo: dados.ativo,
    },
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
      desativar: { type: 'boolean', default: false },
    },
  });

  if (!values.email && !values.id)
    throw new Error('Informe --email (ou --id do usuário no Supabase)');

  const id = values.id ?? (await buscarIdNoSupabase(values.email!));
  if (!id) throw new Error(`Nenhuma conta com e-mail ${values.email} em Authentication > Users`);

  const prisma = new PrismaClient();
  try {
    const usuario = await liberarUsuario(prisma, {
      id,
      email: values.email,
      nome: values.nome,
      ativo: !values.desativar,
    });
    console.log(`${usuario.ativo ? 'Liberado' : 'Desativado'}: ${usuario.email ?? usuario.id}`);
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
