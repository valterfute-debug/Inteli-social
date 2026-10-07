import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SituacaoFoto } from '@prisma/client';
import { EscopoAcesso, ehAdmin, filtroPorUnidade, garantirUnidade } from '../auth/escopo';
import {
  AcaoAuditoria,
  AuditoriaService,
  calcularCamposAlterados,
} from '../auditoria/auditoria.service';
import { IdempotenciaService } from '../idempotencia/idempotencia.service';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import { AtualizarAnimalDto } from './dto/atualizar-animal.dto';
import { CriarAnimalDto } from './dto/criar-animal.dto';
import { ListarAnimaisQueryDto } from './dto/listar-animais-query.dto';
import { AnimalComRelacoes, INCLUSAO_ANIMAL, mapearAnimal } from './animal.mapper';
import { gerarIdentificadorPublico } from './identificador-publico.util';
import { EstadoAdmissao, validarRegrasAdmissao } from './regras-admissao';

const TENTATIVAS_MAXIMAS_IDENTIFICADOR = 3;

@Injectable()
export class AnimalsService {
  private readonly logger = new Logger(AnimalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SupabaseStorageService,
    private readonly idempotencia: IdempotenciaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(query: ListarAnimaisQueryDto, escopo: EscopoAcesso) {
    const { pagina, limite } = query;
    // Filtro do cliente E escopo do servidor: pedir outra unidade só devolve lista vazia.
    const where: Prisma.AnimalWhereInput = {
      AND: [this.montarFiltroListagem(query), filtroPorUnidade(escopo)],
    };

    const [itens, total] = await Promise.all([
      this.prisma.animal.findMany({
        where,
        include: INCLUSAO_ANIMAL,
        skip: (pagina - 1) * limite,
        take: limite,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      }),
      this.prisma.animal.count({ where }),
    ]);

    const urls = await this.gerarUrlsFotos(itens);
    return {
      itens: itens.map((animal) => mapearAnimal(animal, this.urlDaFoto(animal, urls))),
      pagina,
      limite,
      total,
    };
  }

  montarFiltroListagem(query: ListarAnimaisQueryDto): Prisma.AnimalWhereInput {
    const { busca, nome, identificadorPublico, microchip, especieId, frente, unidadeId } = query;
    return {
      deletedAt: null,
      ...(busca
        ? {
            OR: [
              { name: { contains: busca, mode: 'insensitive' } },
              { publicId: { contains: busca, mode: 'insensitive' } },
              { microchip: { startsWith: busca } },
            ],
          }
        : {}),
      ...(nome ? { name: { contains: nome, mode: 'insensitive' } } : {}),
      ...(identificadorPublico
        ? { publicId: { equals: identificadorPublico, mode: 'insensitive' } }
        : {}),
      ...(microchip ? { microchip } : {}),
      ...(especieId ? { speciesId: especieId } : {}),
      ...(frente ? { front: frente } : {}),
      ...(unidadeId ? { unitId: unidadeId } : {}),
    };
  }

  /**
   * Admissão idempotente. A chave é conferida ANTES das validações: um reenvio legítimo não
   * pode esbarrar no próprio animal criado na primeira vez (ex.: "microchip já cadastrado").
   */
  async criar(dto: CriarAnimalDto, escopo: EscopoAcesso, chave: string) {
    const ctx = { usuarioId: escopo.usuarioId, chave, operacao: 'POST /animals', conteudo: dto };
    const anterior = await this.idempotencia.verificarReenvio(ctx);
    if (anterior) return { animal: await this.buscarPorId(anterior, escopo), reenvio: true };

    garantirUnidade(escopo, dto.unidadeId);
    for (let tentativa = 1; tentativa <= TENTATIVAS_MAXIMAS_IDENTIFICADOR; tentativa++) {
      const identificadorPublico = gerarIdentificadorPublico();
      try {
        const { recursoId, resultado, reenvio } = await this.idempotencia.executar(
          ctx,
          async (tx) => {
            // A reserva da chave vem antes destas leituras: outra requisição idêntica
            // aguarda o commit e faz replay, sem rejeitar o microchip que ela mesma criou.
            const especieSilvestre = await this.obterEspecieSilvestre(dto.especieId, tx);
            this.garantirRegrasAdmissao({
              frente: dto.frente,
              especieSilvestre,
              nome: dto.nome,
              microchip: dto.microchip,
              sexo: dto.sexo,
              idadeAproximadaMeses: dto.idadeAproximadaMeses,
              pesoKg: dto.pesoKg,
              porte: dto.porte,
            });
            if (dto.microchip)
              await this.garantirMicrochipDisponivel(dto.microchip, escopo, undefined, tx);
            await this.garantirFotoConfirmada(dto.fotoEntradaId, escopo, tx);
            const criado = await tx.animal.create({
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
              include: INCLUSAO_ANIMAL,
            });
            await this.auditoria.registrar(tx, {
              usuarioId: escopo.usuarioId,
              acao: AcaoAuditoria.ANIMAL_CRIADO,
              entidade: 'Animal',
              entidadeId: criado.id,
              unidadeId: criado.unitId,
              frente: criado.front,
            });
            return { recursoId: criado.id, resultado: criado };
          },
        );
        // Outra requisição com a mesma chave confirmou primeiro: devolve o animal dela.
        if (reenvio || !resultado) {
          return { animal: await this.buscarPorId(recursoId, escopo), reenvio: true };
        }
        return { animal: await this.mapearComFoto(resultado), reenvio: false };
      } catch (erro) {
        const colisaoDeIdentificador =
          erro instanceof Prisma.PrismaClientKnownRequestError &&
          erro.code === 'P2002' &&
          (erro.meta?.target as string[] | undefined)?.includes('publicId');
        if (colisaoDeIdentificador && tentativa < TENTATIVAS_MAXIMAS_IDENTIFICADOR) continue;
        this.tratarErroPrisma(erro);
      }
    }
    throw new ConflictException('Não foi possível gerar um identificador público único');
  }

  async buscarPorId(id: string, escopo: EscopoAcesso) {
    const animal = await this.prisma.animal.findFirst({
      where: { id, deletedAt: null },
      include: INCLUSAO_ANIMAL,
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, animal.unitId);
    return this.mapearComFoto(animal);
  }

  async atualizar(id: string, dto: AtualizarAnimalDto, escopo: EscopoAcesso) {
    const { versao, ...dados } = dto;
    if (Object.keys(dados).length === 0) {
      throw new BadRequestException('Informe ao menos um campo além da versão');
    }

    const existente = await this.prisma.animal.findFirst({
      where: { id, deletedAt: null },
      include: { species: true },
    });
    if (!existente) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, existente.unitId);
    // Transferir para outra unidade exige acesso também à unidade de destino.
    if (dados.unidadeId !== undefined) garantirUnidade(escopo, dados.unidadeId);
    if (existente.version !== versao) throw new ConflictException('Versão desatualizada');

    // As regras valem para o estado final: numa transferência CED → CasAdote, por exemplo,
    // basta enviar frente/unidade/localização e o restante vem do cadastro atual.
    const valorFinal = <T>(novo: T | undefined, atual: T) => (novo !== undefined ? novo : atual);
    const especieSilvestre =
      dados.especieId !== undefined && dados.especieId !== existente.speciesId
        ? await this.obterEspecieSilvestre(dados.especieId)
        : existente.species.silvestre;
    this.garantirRegrasAdmissao({
      frente: valorFinal(dados.frente, existente.front),
      especieSilvestre,
      nome: valorFinal(dados.nome, existente.name),
      microchip: valorFinal(dados.microchip, existente.microchip),
      sexo: valorFinal(dados.sexo, existente.sexo),
      idadeAproximadaMeses: valorFinal(dados.idadeAproximadaMeses, existente.idadeAproximadaMeses),
      pesoKg: valorFinal(dados.pesoKg, existente.pesoKg === null ? null : Number(existente.pesoKg)),
      porte: valorFinal(dados.porte, existente.porte),
    });
    if (dados.microchip && dados.microchip !== existente.microchip) {
      await this.garantirMicrochipDisponivel(dados.microchip, escopo, id);
    }
    if (dados.fotoEntradaId !== undefined) {
      await this.garantirFotoConfirmada(dados.fotoEntradaId, escopo);
    }

    // Nomes das colunas do banco; undefined = campo não enviado (não muda).
    const alteracoes = {
      name: dados.nome,
      microchip: dados.microchip,
      speciesId: dados.especieId,
      breedId: dados.racaId,
      unitId: dados.unidadeId,
      locationId: dados.localizacaoId,
      responsibleId: dados.responsavelId,
      front: dados.frente,
      dataEntrada: dados.dataEntrada !== undefined ? new Date(dados.dataEntrada) : undefined,
      sexo: dados.sexo,
      idadeAproximadaMeses: dados.idadeAproximadaMeses,
      pesoKg: dados.pesoKg,
      porte: dados.porte,
      cor: dados.cor,
      observacoes: dados.observacoes,
      fotoEntradaId: dados.fotoEntradaId,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        const resultado = await tx.animal.updateMany({
          where: { id, deletedAt: null, version: versao },
          data: { ...alteracoes, version: { increment: 1 } },
        });
        // Outra edição venceu entre a leitura acima e esta escrita.
        if (resultado.count === 0) throw new ConflictException('Versão desatualizada');

        await this.auditoria.registrar(tx, {
          usuarioId: escopo.usuarioId,
          acao: AcaoAuditoria.ANIMAL_ATUALIZADO,
          entidade: 'Animal',
          entidadeId: id,
          unidadeId: alteracoes.unitId ?? existente.unitId,
          frente: alteracoes.front ?? existente.front,
          camposAlterados: calcularCamposAlterados(existente, alteracoes),
        });
      });

      return this.buscarPorId(id, escopo);
    } catch (erro) {
      if (
        erro instanceof NotFoundException ||
        erro instanceof ConflictException ||
        erro instanceof ForbiddenException
      ) {
        throw erro;
      }
      this.tratarErroPrisma(erro);
    }
  }

  async arquivar(id: string, escopo: EscopoAcesso) {
    const animal = await this.prisma.animal.findFirst({
      where: { id, deletedAt: null },
      select: { unitId: true, front: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, animal.unitId);

    await this.prisma.$transaction(async (tx) => {
      const resultado = await tx.animal.updateMany({
        where: { id, deletedAt: null, ...filtroPorUnidade(escopo) },
        data: { deletedAt: new Date() },
      });
      if (resultado.count === 0) throw new NotFoundException('Animal não encontrado');
      await this.auditoria.registrar(tx, {
        usuarioId: escopo.usuarioId,
        acao: AcaoAuditoria.ANIMAL_ARQUIVADO,
        entidade: 'Animal',
        entidadeId: id,
        unidadeId: animal.unitId,
        frente: animal.front,
      });
    });
  }

  private garantirRegrasAdmissao(estado: EstadoAdmissao) {
    const violacoes = validarRegrasAdmissao(estado);
    if (violacoes.length > 0) throw new BadRequestException(violacoes);
  }

  private async obterEspecieSilvestre(
    especieId: string,
    cliente: Prisma.TransactionClient = this.prisma,
  ) {
    const especie = await cliente.species.findFirst({
      where: { id: especieId, deletedAt: null },
      select: { silvestre: true },
    });
    if (!especie) throw new BadRequestException('Espécie não encontrada');
    return especie.silvestre;
  }

  /**
   * O microchip acompanha o animal entre frentes (ex.: chega pelo CED e vai para o CasAdote),
   * então um segundo cadastro com o mesmo número é, na prática, o mesmo animal. O 409 devolve
   * o cadastro existente para o frontend oferecer a transferência em vez de duplicar a ficha.
   */
  private async garantirMicrochipDisponivel(
    microchip: string,
    escopo: EscopoAcesso,
    ignorarId?: string,
    cliente: Prisma.TransactionClient = this.prisma,
  ) {
    const existente = await cliente.animal.findFirst({
      where: {
        microchip,
        deletedAt: null,
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
      },
      select: { id: true, publicId: true, unitId: true },
    });
    if (existente) {
      // A unicidade é global, mas a ficha existente só pode ser identificada por
      // quem tem acesso à unidade. Não revelar IDs de outra unidade no erro.
      if (!ehAdmin(escopo) && !escopo.unidadeIds.includes(existente.unitId)) {
        throw new ConflictException('Microchip já cadastrado em outro animal ativo');
      }
      throw new ConflictException({
        message: `Microchip já cadastrado no animal ${existente.publicId}`,
        detalhes: {
          animalExistenteId: existente.id,
          identificadorPublico: existente.publicId,
        },
      });
    }
  }

  private async garantirFotoConfirmada(
    fotoEntradaId: string,
    escopo: EscopoAcesso,
    cliente: Prisma.TransactionClient = this.prisma,
  ) {
    const foto = await cliente.foto.findUnique({ where: { id: fotoEntradaId } });
    if (!foto) throw new BadRequestException('Foto não encontrada');
    // Só quem enviou a foto (ou um admin) pode vinculá-la a uma ficha.
    if (foto.criadoPorId !== escopo.usuarioId && !ehAdmin(escopo)) {
      throw new ForbiddenException('Foto enviada por outro usuário');
    }
    if (foto.situacao !== SituacaoFoto.CONFIRMADA) {
      throw new BadRequestException('Foto ainda não confirmada');
    }
  }

  private async mapearComFoto(animal: AnimalComRelacoes) {
    const urls = await this.gerarUrlsFotos([animal]);
    return mapearAnimal(animal, this.urlDaFoto(animal, urls));
  }

  private urlDaFoto(animal: AnimalComRelacoes, urls: Map<string, string>) {
    const foto = animal.fotoEntrada;
    if (!foto || foto.situacao !== SituacaoFoto.CONFIRMADA) return null;
    return urls.get(foto.caminhoArmazenamento) ?? null;
  }

  /** Falha no Storage não derruba a consulta: a ficha é exibida sem a imagem. */
  private async gerarUrlsFotos(animais: AnimalComRelacoes[]) {
    const caminhos = animais
      .map((animal) => animal.fotoEntrada)
      .filter((foto) => foto?.situacao === SituacaoFoto.CONFIRMADA)
      .map((foto) => foto!.caminhoArmazenamento);
    if (caminhos.length === 0) return new Map<string, string>();
    try {
      return await this.storage.criarUrlsLeitura(caminhos);
    } catch (erro) {
      this.logger.warn(`Fotos exibidas sem URL: ${(erro as Error).message}`);
      return new Map<string, string>();
    }
  }

  private tratarErroPrisma(erro: unknown): never {
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
      if (erro.code === 'P2002') {
        const alvo = JSON.stringify(erro.meta ?? {});
        if (alvo.includes('microchip')) {
          throw new ConflictException('Microchip já cadastrado em outro animal ativo');
        }
        throw new ConflictException(
          alvo?.includes('fotoEntradaId')
            ? 'Esta foto já está vinculada a outro animal'
            : 'Violação de unicidade',
        );
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
