import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

/**
 * Restaura um backup num banco ISOLADO (só localhost) e confere a integridade:
 * contagens, FKs, e se cada ficha aponta para uma foto cujo arquivo existe no backup
 * com o mesmo hash do manifesto.
 *
 *   npm run backup:verificar -- --backup ./backups/<pasta> --destino postgresql://postgres@localhost:5432/restauracao
 */
async function executar() {
  const { values } = parseArgs({
    options: { backup: { type: 'string' }, destino: { type: 'string' } },
  });
  if (!values.backup || !values.destino) throw new Error('Informe --backup e --destino');
  if (!['localhost', '127.0.0.1'].includes(new URL(values.destino).hostname)) {
    throw new Error('--destino precisa ser um banco local e descartável (localhost)');
  }

  execFileSync(
    process.env.PG_RESTORE ?? 'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      `--dbname=${values.destino}`,
      join(values.backup, 'banco.dump'),
    ],
    { stdio: 'inherit' },
  );

  const manifesto = JSON.parse(readFileSync(join(values.backup, 'manifesto.json'), 'utf8')) as {
    fotos: Record<string, string>;
  };
  const prisma = new PrismaClient({ datasources: { db: { url: values.destino } } });
  try {
    const [animais, fotos, eventos, auditoria] = await Promise.all([
      prisma.animal.count(),
      prisma.foto.count(),
      prisma.healthEvent.count(),
      prisma.eventoAuditoria.count().catch(() => 0),
    ]);
    const fichas = await prisma.animal.findMany({
      where: { fotoEntradaId: { not: null } },
      select: { publicId: true, fotoEntrada: { select: { caminhoArmazenamento: true } } },
    });
    const problemas: string[] = [];
    for (const ficha of fichas) {
      const caminho = ficha.fotoEntrada?.caminhoArmazenamento;
      if (!caminho) {
        problemas.push(`${ficha.publicId}: foto referenciada não existe no banco restaurado`);
        continue;
      }
      const arquivo = join(values.backup, 'storage', caminho);
      if (!existsSync(arquivo)) {
        problemas.push(`${ficha.publicId}: arquivo ${caminho} ausente no backup`);
      } else if (
        createHash('sha256').update(readFileSync(arquivo)).digest('hex') !==
        manifesto.fotos[caminho]
      ) {
        problemas.push(`${ficha.publicId}: arquivo ${caminho} diferente do manifesto`);
      }
    }
    console.log(
      JSON.stringify(
        {
          animais,
          fotos,
          eventosSaude: eventos,
          eventosAuditoria: auditoria,
          fichasComFoto: fichas.length,
          problemas,
        },
        null,
        2,
      ),
    );
    if (problemas.length > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

executar().catch((erro: unknown) => {
  console.error((erro as Error).message);
  process.exitCode = 1;
});
