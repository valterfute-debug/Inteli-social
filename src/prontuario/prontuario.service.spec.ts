import { inflateSync } from 'node:zlib';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import sharp from 'sharp';
import { NotFoundException } from '@nestjs/common';
import { Front, Sexo, TipoAtendimento, TipoEventoSaude } from '@prisma/client';
import { ProntuarioService } from './prontuario.service';
import { formatarDataLocal, quebrarTexto } from './prontuario.util';
import { PrismaService } from '../prisma/prisma.service';

function criarAnimalComRelacoesFalso() {
  return {
    id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    name: 'Rex',
    publicId: 'QA-001',
    microchip: null,
    dataEntrada: new Date('2026-01-01T00:00:00.000Z'),
    sexo: Sexo.MACHO,
    idadeAproximadaMeses: 24,
    pesoKg: null,
    porte: null,
    cor: 'Caramelo',
    speciesId: 'especie-1',
    species: { id: 'especie-1', name: 'Cão' },
    breedId: null,
    breed: null,
    unitId: 'unidade-1',
    unit: { id: 'unidade-1', name: 'Unidade Central' },
    responsibleId: 'responsavel-1',
    responsible: { id: 'responsavel-1', name: 'Maria', endereco: 'Rua das Flores, 10' },
    front: Front.CASADOTE,
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };
}

function criarPrismaFalso() {
  return {
    animal: { findFirst: jest.fn() },
    healthEvent: { findMany: jest.fn() },
    atendimentoClinico: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as PrismaService;
}

describe('ProntuarioService', () => {
  it('identifica a continuação de um atendimento extenso em outra página', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([{
      tipo: TipoAtendimento.ACOMPANHAMENTO, dataAtendimento: new Date('2026-10-10T12:00:00Z'),
      responsible: { name: 'Equipe sintética' }, anexos: [],
      anamnese: 'Observação sintética extensa. '.repeat(1200), exameFisico: null,
      examesComplementares: null, tratamento: null,
    }]);
    const pdf = await new ProntuarioService(prisma).gerarPdf('animal');
    const conteudo = textoDasPaginas(pdf).toUpperCase();
    expect(conteudo).toContain(Buffer.from('Acompanhamento - 10/10/2026 (continuação)', 'latin1').toString('hex').toUpperCase());
    expect(conteudo).toContain(Buffer.from('3. Anamnese (continuação):', 'latin1').toString('hex').toUpperCase());
  });
  it.each(['jpeg', 'png', 'webp'] as const)('inclui foto %s confirmada no PDF', async (format) => {
    const prisma = criarPrismaFalso();
    const animal = { ...criarAnimalComRelacoesFalso(), fotoEntrada: { situacao: 'CONFIRMADA', caminhoArmazenamento: 'admissao/foto' } };
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(animal);
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: '#268a61' } }).toFormat(format).toBuffer();
    const storage = { baixarFoto: jest.fn().mockResolvedValue(bytes) };
    const pdf = await new ProntuarioService(prisma, storage as never).gerarPdf('animal');
    const doc = await PDFDocument.load(pdf);
    const resources = doc.getPage(0).node.Resources()!;
    const images = resources.lookup(PDFName.of('XObject'), PDFDict);
    expect(images.keys().length).toBeGreaterThan(0);
    expect(storage.baixarFoto).toHaveBeenCalledWith('admissao/foto');
  });

  it('informa erro quando uma foto confirmada não pode ser recuperada', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue({ ...criarAnimalComRelacoesFalso(), fotoEntrada: { situacao: 'CONFIRMADA', caminhoArmazenamento: 'admissao/foto' } });
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    const storage = { baixarFoto: jest.fn().mockRejectedValue(new Error('indisponível')) };
    await expect(new ProntuarioService(prisma, storage as never).gerarPdf('animal')).rejects.toThrow('Não foi possível incluir a foto');
  });
  it('aplica a identidade da Ampara a todas as páginas do prontuário', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([{
      tipo: TipoAtendimento.ADMISSAO, dataAtendimento: new Date(),
      responsible: { name: 'Equipe sintética' }, anexos: [],
      anamnese: 'Histórico fictício '.repeat(300), exameFisico: null,
      examesComplementares: null, tratamento: null,
    }]);
    const pdf = await new ProntuarioService(prisma).gerarPdf('animal');
    const content = textoDasPaginas(pdf);
    expect((content.match(/0 0\.847 0\.38 rg/g) ?? []).length).toBeGreaterThan(1);
    const marca = Buffer.from('Instituto Ampara Animal', 'latin1').toString('hex').toUpperCase();
    expect((content.toUpperCase().match(new RegExp(marca, 'g')) ?? []).length).toBeGreaterThan(1);
  });
  it('exporta as seis medidas, observações e inventário de anexos sem links temporários', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([
      {
        tipo: TipoAtendimento.ACOMPANHAMENTO,
        dataAtendimento: new Date(),
        responsible: { name: 'Pessoa sintética' },
        frequenciaRespiratoria: 20,
        frequenciaCardiaca: 90,
        tpc: 1.5,
        mucosa: 'Rosada',
        linfonodos: 'Descrição sintética',
        temperatura: 38.300000000000004,
        exameFisico: 'Observação anterior preservada',
        anexos: [
          { id: 'id-pdf', nome: 'hemograma.pdf', tipoMidia: 'application/pdf', tamanhoBytes: 1234 },
        ],
      },
    ]);
    const pdf = await new ProntuarioService(prisma).gerarPdf('animal');
    const text = textoDasPaginas(pdf).toUpperCase();
    for (const value of [
      'Frequência respiratória: 20 movimentos/min',
      'Frequência cardíaca: 90 batimentos/min',
      'TPC: 1.5 s',
      'Mucosa: Rosada',
      'Linfonodos: Descrição sintética',
      'Temperatura: 38,3 °C',
      'Observação anterior preservada',
      'hemograma.pdf',
    ]) {
      expect(text).toContain(Buffer.from(value, 'latin1').toString('hex').toUpperCase());
    }
    expect(text).not.toContain(Buffer.from('https://', 'latin1').toString('hex').toUpperCase());
  });

  it('rejeita geração de PDF para animal inexistente com 404', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(null);
    const service = new ProntuarioService(prisma);

    await expect(service.gerarPdf('id-inexistente')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('gera um PDF válido com os dados do animal e histórico de saúde', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'evento-1',
        animalId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
        tipo: TipoEventoSaude.VACINA,
        descricao: 'V10',
        data: new Date('2026-02-01T00:00:00.000Z'),
        observacoes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    ]);
    const service = new ProntuarioService(prisma);

    const pdf = await service.gerarPdf('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');

    expect(pdf).toBeInstanceOf(Buffer);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('gera um PDF mesmo sem eventos de saúde registrados', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    const service = new ProntuarioService(prisma);

    const pdf = await service.gerarPdf('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('inclui os atendimentos clínicos no PDF, com texto longo e quebras de linha', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'atendimento-1',
        tipo: TipoAtendimento.ADMISSAO,
        dataAtendimento: new Date('2026-02-01T00:00:00.000Z'),
        responsible: { name: 'Maria' },
        anamnese: `Resgatado na rua.\nSem histórico vacinal. ${'Apático e desidratado. '.repeat(80)}`,
        anexos: [],
        exameFisico: 'Temperatura 38,5 °C',
        examesComplementares: null,
        tratamento: 'Hidratação \u{1F436}',
      },
    ]);
    const service = new ProntuarioService(prisma);

    const pdf = await service.gerarPdf('a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1');

    expect(prisma.atendimentoClinico.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { animalId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', deletedAt: null },
      }),
    );
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('cada atendimento segue as 6 seções do exame clínico, na ordem combinada', async () => {
    const prisma = criarPrismaFalso();
    (prisma.animal.findFirst as jest.Mock).mockResolvedValue(criarAnimalComRelacoesFalso());
    (prisma.healthEvent.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.atendimentoClinico.findMany as jest.Mock).mockResolvedValue([
      {
        id: 'atendimento-1',
        tipo: TipoAtendimento.ADMISSAO,
        dataAtendimento: new Date('2026-02-01T00:00:00.000Z'),
        responsible: { name: 'Maria', endereco: 'Rua das Flores, 10', telefone: null },
        anamnese: 'a',
        anexos: [],
        exameFisico: 'b',
        examesComplementares: 'c',
        tratamento: 'd',
      },
    ]);

    const pdf = await new ProntuarioService(prisma).gerarPdf(
      'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1',
    );

    // O pdf-lib comprime o conteúdo das páginas e grava cada texto em hexadecimal (WinAnsi).
    const conteudo = textoDasPaginas(pdf).toUpperCase();
    const posicoes = [
      '1. Identificação do animal',
      '2. Identificação do responsável',
      '3. Anamnese',
      '4. Exame físico',
      '5. Exames complementares',
      '6. Tratamento',
    ].map((titulo) =>
      conteudo.indexOf(Buffer.from(`${titulo}:`, 'latin1').toString('hex').toUpperCase()),
    );
    expect(posicoes.every((posicao) => posicao >= 0)).toBe(true);
    expect([...posicoes].sort((a, b) => a - b)).toEqual(posicoes);
    // A unidade saiu da ficha (pedido da Ampara).
    expect(conteudo).not.toContain(Buffer.from('Unidade:', 'latin1').toString('hex').toUpperCase());
  });
});

/** Junta o conteúdo descomprimido de todos os blocos (streams) do PDF. */
function textoDasPaginas(pdf: Buffer) {
  const bruto = pdf.toString('latin1');
  const partes: string[] = [];
  for (const trecho of bruto.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    try {
      partes.push(inflateSync(Buffer.from(trecho[1], 'latin1')).toString('latin1'));
    } catch {
      // Bloco que não é conteúdo comprimido (ex.: fonte): ignorado.
    }
  }
  return partes.join('\n');
}

describe('formatarDataLocal', () => {
  it('usa o fuso de São Paulo: 22h do dia 1º continua dia 1º', () => {
    expect(formatarDataLocal(new Date('2026-02-02T01:00:00.000Z'))).toBe('01/02/2026');
  });
});

describe('quebrarTexto', () => {
  const largura = (trecho: string) => trecho.length;

  it('quebra por palavras sem ultrapassar a largura e respeita parágrafos', () => {
    expect(quebrarTexto('um dois tres\nquatro', largura, 8)).toEqual(['um dois', 'tres', 'quatro']);
  });

  it('parte palavras maiores que a linha em vez de estourar a margem', () => {
    expect(quebrarTexto('abcdefghij', largura, 4)).toEqual(['abcd', 'efgh', 'ij']);
  });

  it('troca caracteres que a fonte do PDF não codifica', () => {
    expect(quebrarTexto('ok \u{1F436}', largura, 20)).toEqual(['ok ??']);
  });
});
