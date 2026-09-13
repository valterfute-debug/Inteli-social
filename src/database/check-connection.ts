import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

async function checkConnection() {
  const prisma = new PrismaClient();
  await prisma.$queryRawUnsafe('SELECT 1');
  await prisma.$disconnect();
  console.log('Conexão PostgreSQL verificada com sucesso.');
}
void checkConnection().catch((error: unknown) => {
  console.error('Não foi possível conectar ao PostgreSQL.', error);
  process.exitCode = 1;
});
