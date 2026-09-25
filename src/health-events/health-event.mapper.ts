import { HealthEvent } from '@prisma/client';

export function mapearEventoSaude(evento: HealthEvent) {
  return {
    id: evento.id,
    animalId: evento.animalId,
    tipo: evento.tipo,
    descricao: evento.descricao,
    data: evento.data.toISOString(),
    observacoes: evento.observacoes,
    criadoEm: evento.createdAt.toISOString(),
    atualizadoEm: evento.updatedAt.toISOString(),
    arquivadoEm: evento.deletedAt ? evento.deletedAt.toISOString() : null,
  };
}
