import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AtualizarAnimalDto } from './dto/atualizar-animal.dto';
import { CriarAnimalDto } from './dto/criar-animal.dto';
import { ListarAnimaisQueryDto } from './dto/listar-animais-query.dto';
import { mapearAnimal } from './animal.mapper';
import { gerarIdentificadorPublico } from './identificador-publico.util';

const TENTATIVAS_MAXIMAS_IDENTIFICADOR = 3;

@Injectable()
export class AnimalsService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(query: ListarAnimaisQueryDto) {
    const { pagina, limite, nome, identificadorPublico, especieId } = query;
    const where: Prisma.AnimalWhereInput = {
      deletedAt: null,
      ...(nome ? { name: { contains: nome, mode: 'insensitive' } } : {}),
      ...(identificadorPublico ? { publicId: identificadorPublico } : {}),
      ...(especieId ? { speciesId: especieId } : {}),
    };

    const [itens, total] = await Promise.all([
      this.prisma.animal.findMany({
        where,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.animal.count({ where }),
    ]);

    return { itens: itens.map(mapearAnimal), pagina, limite, total };
  }

  async criar(dto: CriarAnimalDto) {
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS_IDENTIFICADOR; tentativa++) {
      const identificadorPublico = gerarIdentificadorPublico();
      try {
        const animal = await this.prisma.animal.create({
          data: {
            id: randomUUID(),
            publicId: identificadorPublico,
            name: dto.nome,
            microchip: dto.microchip,
            speciesId: dto.especieId,
            breedId: dto.racaId,
            unitId: dto.unidadeId,
            locationId: dto.localizacaoId,
            responsibleId: dto.responsavelId,
            front: dto.frente,
            dataEntrada: dto.dataEntrada ? new Date(dto.dataEntrada) : undefined,
            sexo: dto.sexo,
            idadeAproximadaMeses: dto.idadeAproximadaMeses,
            pesoKg: dto.pesoKg,
            porte: dto.porte,
            cor: dto.cor,
            observacoes: dto.observacoes,
            fotoEntradaId: dto.fotoEntradaId,
          },
        });
        return mapearAnimal(animal);
      } catch (erro) {
        const colisaoDeIdentificador =
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === 'P2002' &&
          (erro.meta?.target as string[] | undefined)?.includes('publicId');
        if (colisaoDeIdentificador && tentativa < TENTATIVAS_MAXIMAS_IDENTIFICADOR) continue;
        this.tratarErroPrisma(erro);
      }
    }
  }

  async buscarPorId(id: string) {
    const animal = await this.prisma.animal.findFirst({ where: { id, deletedAt: null } });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    return mapearAnimal(animal);
  }

  async atualizar(id: string, dto: AtualizarAnimalDto) {
    const { versao, ...dados } = dto;
    if (Object.keys(dados).length === 0) {
      throw new BadRequestException('Informe ao menos um campo além da versão');
    }

    try {
      const resultado = await this.prisma.animal.updateMany({
        where: { id, deletedAt: null, version: versao },
        data: {
          ...(dados.nome !== undefined ? { name: dados.nome } : {}),
          ...(dados.microchip !== undefined ? { microchip: dados.microchip } : {}),
          ...(dados.especieId !== undefined ? { speciesId: dados.especieId } : {}),
          ...(dados.racaId !== undefined ? { breedId: dados.racaId } : {}),
          ...(dados.unidadeId !== undefined ? { unitId: dados.unidadeId } : {}),
          ...(dados.localizacaoId !== undefined ? { locationId: dados.localizacaoId } : {}),
          ...(dados.responsavelId !== undefined ? { responsibleId: dados.responsavelId } : {}),
          ...(dados.frente !== undefined ? { front: dados.frente } : {}),
          ...(dados.dataEntrada !== undefined ? { dataEntrada: new Date(dados.dataEntrada) } : {}),
          ...(dados.sexo !== undefined ? { sexo: dados.sexo } : {}),
          ...(dados.idadeAproximadaMeses !== undefined
            ? { idadeAproximadaMeses: dados.idadeAproximadaMeses }
            : {}),
          ...(dados.pesoKg !== undefined ? { pesoKg: dados.pesoKg } : {}),
          ...(dados.porte !== undefined ? { porte: dados.porte } : {}),
          ...(dados.cor !== undefined ? { cor: dados.cor } : {}),
          ...(dados.observacoes !== undefined ? { observacoes: dados.observacoes } : {}),
          ...(dados.fotoEntradaId !== undefined ? { fotoEntradaId: dados.fotoEntradaId } : {}),
          version: { increment: 1 },
        },
      });

      if (resultado.count === 0) {
        const existente = await this.prisma.animal.findFirst({ where: { id, deletedAt: null } });
        if (!existente) throw new NotFoundException('Animal não encontrado');
        throw new ConflictException('Versão desatualizada');
      }

      return this.buscarPorId(id);
    } catch (erro) {
      if (erro instanceof NotFoundException || erro instanceof ConflictException) throw erro;
      this.tratarErroPrisma(erro);
    }
  }

  async arquivar(id: string) {
    const resultado = await this.prisma.animal.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (resultado.count === 0) throw new NotFoundException('Animal não encontrado');
  }

  private tratarErroPrisma(erro: unknown): never {
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === 'P2002') {
        throw new ConflictException('Violação de unicidade');
      }
      if (erro.code === 'P2003' || erro.code === 'P2025') {
        throw new BadRequestException(
          'Referência inválida: verifique espécie, raça, unidade, localização ou responsável',
        );
      }
    }
    throw erro;
  }
}
