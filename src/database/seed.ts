import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Catálogos mínimos para um banco novo conseguir receber admissões.
 * Fonte: TAPI (localizações e espécies) e reuniões com a Ampara. A lista deve ser
 * revisada com a Ampara; incluir itens aqui e rodar de novo é seguro (idempotente).
 */
export const CATALOGO_INICIAL = {
  especies: [
    { nome: 'Cão', silvestre: false, racas: ['SRD (sem raça definida)'] },
    { nome: 'Gato', silvestre: false, racas: ['SRD (sem raça definida)'] },
    { nome: 'Onça-pintada', silvestre: true, racas: [] },
    { nome: 'Outro silvestre', silvestre: true, racas: [] },
  ],
  unidades: [
    { nome: 'CCPA', localizacoes: ['Geral'] },
    { nome: 'CED', localizacoes: ['Colônia'] },
    { nome: 'CasAdote', localizacoes: ['Gatil', 'Canil'] },
    { nome: 'Encontrei um Amigo', localizacoes: ['Canil'] },
    { nome: 'Mutirão', localizacoes: ['Geral'] },
    { nome: 'Mantenedor', localizacoes: ['Geral'] },
  ],
  // Para animais sem tutor (resgate, colônia): a própria Ampara responde por eles.
  responsaveis: ['Instituto Ampara Animal (sem tutor)'],
};

type ClienteSeed = Pick<PrismaClient, 'species' | 'breed' | 'unit' | 'location' | 'responsible'>;

/** Só cria o que falta; nunca sobrescreve nem reativa registros arquivados. */
export async function popularCatalogos(prisma: ClienteSeed) {
  for (const especie of CATALOGO_INICIAL.especies) {
    const registro = await prisma.species.upsert({
      where: { name: especie.nome },
      create: { name: especie.nome, silvestre: especie.silvestre },
      update: {},
    });
    for (const raca of especie.racas) {
      await prisma.breed.upsert({
        where: { speciesId_name: { speciesId: registro.id, name: raca } },
        create: { name: raca, speciesId: registro.id },
        update: {},
      });
    }
  }

  for (const unidade of CATALOGO_INICIAL.unidades) {
    const registro = await prisma.unit.upsert({
      where: { name: unidade.nome },
      create: { name: unidade.nome },
      update: {},
    });
    for (const localizacao of unidade.localizacoes) {
      await prisma.location.upsert({
        where: { unitId_name: { unitId: registro.id, name: localizacao } },
        create: { name: localizacao, unitId: registro.id },
        update: {},
      });
    }
  }

  for (const nome of CATALOGO_INICIAL.responsaveis) {
    const existente = await prisma.responsible.findFirst({ where: { name: nome } });
    if (!existente) await prisma.responsible.create({ data: { name: nome } });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  popularCatalogos(prisma)
    .then(() => console.log('Catálogos iniciais conferidos/criados com sucesso.'))
    .catch((erro: unknown) => {
      console.error('Falha ao popular catálogos.', erro);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
