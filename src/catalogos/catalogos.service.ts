import { Injectable } from '@nestjs/common';
import { Front } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaginacaoQueryDto } from './dto/paginacao-query.dto';
import { ListarRacasQueryDto } from './dto/listar-racas-query.dto';
import { ListarLocalizacoesQueryDto } from './dto/listar-localizacoes-query.dto';

const NOMES_FRENTES: Record<Front, string> = {
  CCPA: 'Centro de Controle de População Animal',
  CASADOTE: 'CasAdote',
  CED: 'Centro de Educação e Divulgação',
};

@Injectable()
export class CatalogosService {
  constructor(private readonly prisma: PrismaService) {}

  async listarEspecies({ pagina, limite }: PaginacaoQueryDto) {
    const where = { deletedAt: null };
    const [itens, total] = await Promise.all([
      this.prisma.species.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.species.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name })),
      pagina,
      limite,
      total,
    };
  }

  async listarRacas({ pagina, limite, especieId }: ListarRacasQueryDto) {
    const where = { speciesId: especieId };
    const [itens, total] = await Promise.all([
      this.prisma.breed.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.breed.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name, especieId: item.speciesId })),
      pagina,
      limite,
      total,
    };
  }

  async listarUnidades({ pagina, limite }: PaginacaoQueryDto) {
    const where = { deletedAt: null };
    const [itens, total] = await Promise.all([
      this.prisma.unit.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.unit.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name })),
      pagina,
      limite,
      total,
    };
  }

  async listarLocalizacoes({ pagina, limite, unidadeId }: ListarLocalizacoesQueryDto) {
    const where = { unitId: unidadeId };
    const [itens, total] = await Promise.all([
      this.prisma.location.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.location.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name, unidadeId: item.unitId })),
      pagina,
      limite,
      total,
    };
  }

  async listarResponsaveis({ pagina, limite }: PaginacaoQueryDto) {
    const where = { deletedAt: null, active: true };
    const [itens, total] = await Promise.all([
      this.prisma.responsible.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { name: 'asc' },
      }),
      this.prisma.responsible.count({ where }),
    ]);
    return {
      itens: itens.map((item) => ({ id: item.id, nome: item.name })),
      pagina,
      limite,
      total,
    };
  }

  listarFrentes({ pagina, limite }: PaginacaoQueryDto) {
    const todas = (Object.keys(NOMES_FRENTES) as Front[]).map((codigo) => ({
      codigo,
      nome: NOMES_FRENTES[codigo],
    }));
    const inicio = (pagina - 1) * limite;
    return {
      itens: todas.slice(inicio, inicio + limite),
      pagina,
      limite,
      total: todas.length,
    };
  }
}
