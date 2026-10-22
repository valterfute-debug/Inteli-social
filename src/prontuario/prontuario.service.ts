import { Injectable, NotFoundException } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { EscopoAcesso, garantirUnidade } from '../auth/escopo';
import { PrismaService } from '../prisma/prisma.service';
import {
  formatarData,
  formatarDataLocal,
  quebrarTexto,
  sanitizarParaPdf,
  traduzirTipoAtendimento,
  traduzirTipoEvento,
} from './prontuario.util';

const LARGURA_PAGINA = 595.28; // A4 em pontos
const ALTURA_PAGINA = 841.89;
const MARGEM = 50;
const ALTURA_LINHA = 18;

@Injectable()
export class ProntuarioService {
  constructor(private readonly prisma: PrismaService) {}

  async gerarPdf(animalId: string, escopo: EscopoAcesso): Promise<Buffer> {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      include: { species: true, breed: true, unit: true, location: true, responsible: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');
    garantirUnidade(escopo, animal.unitId);

    const eventos = await this.prisma.healthEvent.findMany({
      where: { animalId, deletedAt: null },
      orderBy: { data: 'asc' },
    });

    const atendimentos = await this.prisma.atendimentoClinico.findMany({
      where: { animalId, deletedAt: null },
      include: { responsible: true },
      orderBy: [{ dataAtendimento: 'asc' }, { createdAt: 'asc' }],
    });

    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Helvetica);
    const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);

    let pagina = pdf.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
    let y = ALTURA_PAGINA - MARGEM;

    const novaLinha = (altura = ALTURA_LINHA) => {
      y -= altura;
      if (y < MARGEM) {
        pagina = pdf.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
        y = ALTURA_PAGINA - MARGEM;
      }
    };

    const escrever = (texto: string, opcoes: { negrito?: boolean; tamanho?: number } = {}) => {
      pagina.drawText(sanitizarParaPdf(texto), {
        x: MARGEM,
        y,
        size: opcoes.tamanho ?? 11,
        font: opcoes.negrito ? fonteNegrito : fonte,
        color: rgb(0, 0, 0),
      });
    };

    escrever('Prontuário do Animal', { negrito: true, tamanho: 18 });
    novaLinha(28);
    escrever('Instituto Ampara Animal', { tamanho: 11 });
    novaLinha(24);

    const campo = (rotulo: string, valor: string | null | undefined) => {
      escrever(`${rotulo}: ${valor && valor.length > 0 ? valor : '-'}`);
      novaLinha();
    };

    campo('Identificador público', animal.publicId);
    campo('Nome', animal.name);
    campo('Espécie', animal.species.name);
    campo('Raça', animal.breed?.name);
    campo('Sexo', animal.sexo ?? undefined);
    campo('Porte', animal.porte ?? undefined);
    campo('Cor', animal.cor);
    campo('Idade aproximada (meses)', animal.idadeAproximadaMeses?.toString());
    campo('Peso (kg)', animal.pesoKg?.toString());
    campo('Data de entrada', animal.dataEntrada ? formatarData(animal.dataEntrada) : null);
    campo('Frente', animal.front);
    campo('Unidade', animal.unit.name);
    campo('Localização', animal.location.name);
    campo('Responsável', animal.responsible.name);

    novaLinha(10);
    escrever('Histórico de Saúde', { negrito: true, tamanho: 14 });
    novaLinha(22);

    if (eventos.length === 0) {
      escrever('Nenhum evento de saúde registrado.');
      novaLinha();
    } else {
      for (const evento of eventos) {
        const linha = `${formatarData(evento.data)} — ${traduzirTipoEvento(evento.tipo)}${
          evento.descricao ? ` (${evento.descricao})` : ''
        }`;
        escrever(linha);
        novaLinha();
        if (evento.observacoes) {
          escrever(`  Obs.: ${evento.observacoes}`, { tamanho: 10 });
          novaLinha();
        }
      }
    }

    novaLinha(10);
    escrever('Atendimentos Clínicos', { negrito: true, tamanho: 14 });
    novaLinha(22);

    if (atendimentos.length === 0) {
      escrever('Nenhum atendimento clínico registrado.');
      novaLinha();
    }
    for (const atendimento of atendimentos) {
      escrever(
        `${formatarDataLocal(atendimento.dataAtendimento)} - ${traduzirTipoAtendimento(atendimento.tipo)}`,
        { negrito: true },
      );
      novaLinha();
      campo('Responsável', atendimento.responsible.name);
      const secoes: Array<[string, string | null]> = [
        ['Anamnese', atendimento.anamnese],
        ['Exame físico', atendimento.exameFisico],
        ['Exames complementares', atendimento.examesComplementares],
        ['Tratamento', atendimento.tratamento],
      ];
      for (const [rotulo, texto] of secoes) {
        escrever(`${rotulo}:`, { negrito: true, tamanho: 10 });
        novaLinha(14);
        const largura = (parte: string) => fonte.widthOfTextAtSize(parte, 10);
        for (const linha of quebrarTexto(texto || '-', largura, LARGURA_PAGINA - 2 * MARGEM)) {
          escrever(linha, { tamanho: 10 });
          novaLinha(14);
        }
      }
      novaLinha(10);
    }

    novaLinha(20);
    escrever(`Documento gerado em ${formatarData(new Date())}`, { tamanho: 9 });

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }
}
