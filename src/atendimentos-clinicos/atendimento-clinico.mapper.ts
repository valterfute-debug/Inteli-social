import { Prisma } from '@prisma/client';

/** Animal e responsável do atendimento: a identificação vem do cadastro, não é copiada. */
export const INCLUSAO_ATENDIMENTO = {
  animal: { include: { species: true, breed: true } },
  responsible: true,
} satisfies Prisma.AtendimentoClinicoInclude;

export type AtendimentoComRelacoes = Prisma.AtendimentoClinicoGetPayload<{
  include: typeof INCLUSAO_ATENDIMENTO;
}>;

export function mapearAtendimentoClinico(atendimento: AtendimentoComRelacoes) {
  const { animal, responsible } = atendimento;
  return {
    id: atendimento.id,
    animalId: atendimento.animalId,
    tipo: atendimento.tipo,
    dataAtendimento: atendimento.dataAtendimento.toISOString(),
    animal: {
      id: animal.id,
      identificadorPublico: animal.publicId,
      nome: animal.name,
      especieNome: animal.species.name,
      racaNome: animal.breed ? animal.breed.name : null,
      sexo: animal.sexo,
    },
    // Responsável no momento do atendimento; o endereço é o do cadastro atual dele.
    responsavel: {
      id: responsible.id,
      nome: responsible.name,
      endereco: responsible.endereco,
    },
    anamnese: atendimento.anamnese,
    exameFisico: atendimento.exameFisico,
    examesComplementares: atendimento.examesComplementares,
    tratamento: atendimento.tratamento,
    versao: atendimento.version,
    criadoEm: atendimento.createdAt.toISOString(),
    atualizadoEm: atendimento.updatedAt.toISOString(),
  };
}
