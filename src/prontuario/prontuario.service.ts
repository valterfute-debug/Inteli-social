import { Injectable, InternalServerErrorException, NotFoundException, Optional } from '@nestjs/common';
import { PDFDocument, StandardFonts, rgb, PDFPage, PDFFont } from 'pdf-lib';
import sharp from 'sharp';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';
import {
  formatarData,
  formatarDataLocal,
  quebrarTexto,
  sanitizarParaPdf,
  traduzirTipoAtendimento,
  traduzirTipoEvento,
} from './prontuario.util';

// Dimensões A4 em pontos
const LARGURA_PAGINA = 595.28;
const ALTURA_PAGINA = 841.89;
const MARGEM = 50;
const MARGEM_DIREITA = 50;
const LARGURA_UTIL = LARGURA_PAGINA - MARGEM - MARGEM_DIREITA;
const ALTURA_LINHA = 16;
const ALTURA_RODAPE = 40;

// Paleta Ampara - extraída do frontend
const CORES = {
  brandGreen: rgb(0, 0.847, 0.38), // #00d861
  brandDark: rgb(0.008, 0.059, 0.039), // #020f0a
  primary: rgb(0.075, 0.478, 0.467), // #137a77
  foreground: rgb(0.153, 0.282, 0.302), // #27484d
  mutedForeground: rgb(0.388, 0.424, 0.388), // #636c63
  border: rgb(0.831, 0.851, 0.792), // #d4d9ca
  background: rgb(0.961, 0.965, 0.941), // #f5f6f0
  white: rgb(1, 1, 1),
  black: rgb(0, 0, 0),
};

interface PdfContext {
  pdf: PDFDocument;
  fonte: PDFFont;
  fonteNegrito: PDFFont;
  pagina: PDFPage;
  y: number;
  numeroPagina: number;
  dataGeracao: string;
}

@Injectable()
export class ProntuarioService {
  constructor(private readonly prisma: PrismaService, @Optional() private readonly storage?: SupabaseStorageService) {}

  async gerarPdf(animalId: string): Promise<Buffer> {
    const animal = await this.prisma.animal.findFirst({
      where: { id: animalId, deletedAt: null },
      include: { species: true, breed: true, unit: true, responsible: true, fotoEntrada: true },
    });
    if (!animal) throw new NotFoundException('Animal não encontrado');

    const eventos = await this.prisma.healthEvent.findMany({
      where: { animalId, deletedAt: null },
      orderBy: { data: 'asc' },
    });

    const atendimentos = await this.prisma.atendimentoClinico.findMany({
      where: { animalId, deletedAt: null },
      include: {
        responsible: true,
        anexos: { where: { confirmado: true }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: [{ dataAtendimento: 'asc' }, { createdAt: 'asc' }],
    });

    const pdf = await PDFDocument.create();
    const fonte = await pdf.embedFont(StandardFonts.Helvetica);
    const fonteNegrito = await pdf.embedFont(StandardFonts.HelveticaBold);
    let foto: Awaited<ReturnType<typeof pdf.embedJpg>> | null = null;
    if (animal.fotoEntrada?.situacao === 'CONFIRMADA') {
      try {
        if (!this.storage) throw new Error('Armazenamento indisponível');
        const bytes = await this.storage.baixarFoto(animal.fotoEntrada.caminhoArmazenamento);
        const jpeg = await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate().resize(800, 800, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
        foto = await pdf.embedJpg(jpeg);
      } catch {
        throw new InternalServerErrorException('Não foi possível incluir a foto no prontuário. Tente novamente.');
      }
    }

    const ctx: PdfContext = {
      pdf,
      fonte,
      fonteNegrito,
      pagina: null!,
      y: 0,
      numeroPagina: 0,
      dataGeracao: formatarData(new Date()),
    };

    this.novaPagina(ctx);

    // === DADOS DO ANIMAL ===
    this.desenharTituloSecao(ctx, 'Dados do Animal');
    this.garantirEspaco(ctx, 140);

    const fotoPagina = ctx.pagina;
    const topo = ctx.y;
    const lado = 100;
    const recuo = foto ? lado + 18 : 0;
    let fimFoto = topo;
    if (foto) {
      const dimensoes = foto.scale(Math.min(lado / foto.width, lado / foto.height));
      const topoFoto = topo + ctx.fonteNegrito.heightAtSize(12, { descender: false });
      fimFoto = topoFoto - dimensoes.height;
      ctx.pagina.drawImage(foto, { x: MARGEM + (lado - dimensoes.width) / 2, y: fimFoto, width: dimensoes.width, height: dimensoes.height });
    }

    const identidade = [
      `${animal.name || 'Sem nome informado'}  ·  ${animal.publicId}`,
      [animal.species.name, animal.breed?.name || 'Raça não informada', animal.sexo || 'Sexo não informado'].join(' · '),
      [animal.porte || 'Porte não informado', animal.idadeAproximadaMeses == null ? 'Idade não informada' : `${animal.idadeAproximadaMeses} meses`, animal.pesoKg == null ? 'Peso não informado' : `${animal.pesoKg} kg`].join(' · '),
      animal.cor || 'Cor não informada',
      `${animal.front}  ·  Entrada: ${animal.dataEntrada ? formatarData(animal.dataEntrada) : 'Não informada'}`,
    ];
    for (let indice = 0; indice < identidade.length; indice++) {
      const tamanho = indice === 0 ? 12 : 10;
      const fonteLinha = indice === 0 ? ctx.fonteNegrito : ctx.fonte;
      const linhas = quebrarTexto(identidade[indice], (parte) => fonteLinha.widthOfTextAtSize(parte, tamanho), LARGURA_UTIL - recuo);
      for (const linha of linhas) {
        this.garantirEspaco(ctx, tamanho + 8);
        this.escrever(ctx, linha, { tamanho, recuo, negrito: indice === 0 });
        ctx.y -= tamanho + 8;
      }
    }
    if (foto && ctx.pagina === fotoPagina) ctx.y = Math.min(ctx.y, fimFoto);
    ctx.y -= 24;

    this.desenharTituloSecao(ctx, 'Acolhimento');
    this.escreverParagrafo(ctx, `Responsável: ${animal.responsible.name || 'Não informado'}`, 10);
    if (animal.responsible.endereco) this.escreverParagrafo(ctx, `Endereço: ${animal.responsible.endereco}`, 10);
    ctx.y -= 5;

    // === HISTÓRICO DE SAÚDE ===
    this.desenharTituloSecao(ctx, 'Histórico de Saúde');

    if (eventos.length === 0) {
      this.escrever(ctx, 'Nenhum evento de saúde registrado.', { tamanho: 10, cor: CORES.mutedForeground });
      ctx.y -= ALTURA_LINHA;
    } else {
      for (const evento of eventos) {
        this.garantirEspaco(ctx, 40);
        const dataEvento = formatarData(evento.data);
        const tipoEvento = traduzirTipoEvento(evento.tipo);
        const descricao = evento.descricao ? ` - ${evento.descricao}` : '';

        this.escreverParagrafo(ctx, `${dataEvento}  -  ${tipoEvento}${descricao}`, 10);

        if (evento.observacoes) {
          this.escreverParagrafo(ctx, `Observações: ${evento.observacoes}`, 9, 12);
        }
      }
    }

    ctx.y -= 6;

    // === ATENDIMENTOS CLÍNICOS ===
    this.desenharTituloSecao(ctx, 'Atendimentos Clínicos');

    if (atendimentos.length === 0) {
      this.escrever(ctx, 'Nenhum atendimento clínico registrado.', { tamanho: 10, cor: CORES.mutedForeground });
      ctx.y -= ALTURA_LINHA;
    }

    for (let i = 0; i < atendimentos.length; i++) {
      const atendimento = atendimentos[i];

      const tituloAtendimento = `${traduzirTipoAtendimento(atendimento.tipo)} - ${formatarDataLocal(atendimento.dataAtendimento)}`;

      // Estrutura do exame clínico: seções 1 a 6, na ordem combinada com a Ampara.
      const responsavel = atendimento.responsible;
      const secoes: Array<[string, string | null]> = [
        [
          '1. Identificação do animal',
          [animal.publicId, animal.name, animal.species.name, animal.breed?.name]
            .filter(Boolean)
            .join(' - '),
        ],
        [
          '2. Identificação do responsável',
          [responsavel.name, responsavel.endereco, responsavel.telefone]
            .filter(Boolean)
            .join(' - '),
        ],
        ['3. Anamnese', atendimento.anamnese],
        [
          '4. Exame físico',
          [
            atendimento.frequenciaRespiratoria == null
              ? null
              : `Frequência respiratória: ${atendimento.frequenciaRespiratoria} movimentos/min`,
            atendimento.frequenciaCardiaca == null
              ? null
              : `Frequência cardíaca: ${atendimento.frequenciaCardiaca} batimentos/min`,
            atendimento.tpc == null ? null : `TPC: ${atendimento.tpc} s`,
            atendimento.mucosa == null ? null : `Mucosa: ${atendimento.mucosa}`,
            atendimento.linfonodos == null ? null : `Linfonodos: ${atendimento.linfonodos}`,
            atendimento.temperatura == null ? null : `Temperatura: ${Number(atendimento.temperatura).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} °C`,
            atendimento.frequenciaRespiratoria == null
              ? 'Parâmetros estruturados não registrados neste atendimento.'
              : null,
            atendimento.exameFisico,
          ]
            .filter(Boolean)
            .join('\n'),
        ],
        [
          '5. Exames complementares',
          [
            atendimento.examesComplementares,
            ...atendimento.anexos.map(
              (anexo) =>
                `Anexo: ${anexo.nome} (${anexo.tipoMidia}, ${anexo.tamanhoBytes} bytes; ID ${anexo.id})`,
            ),
            atendimento.anexos.length
              ? 'Arquivos disponíveis no prontuário autenticado. Conteúdo dos anexos não incorporado ao PDF.'
              : null,
          ]
            .filter(Boolean)
            .join('\n'),
        ],
        ['6. Tratamento', atendimento.tratamento],
      ];

      const alturaAtendimento = 50 + secoes.reduce((total, [, texto]) => {
        const linhas = quebrarTexto(texto?.trim() || '-', (parte) => ctx.fonte.widthOfTextAtSize(parte, 9), LARGURA_UTIL - 8);
        return total + 20 + linhas.length * 12;
      }, 0);
      const alturaPaginaUtil = ALTURA_PAGINA - 100 - MARGEM - ALTURA_RODAPE;
      const espacoDisponivel = ctx.y - MARGEM - ALTURA_RODAPE;
      if (alturaAtendimento <= alturaPaginaUtil && espacoDisponivel < alturaAtendimento * 0.7) this.novaPagina(ctx);
      this.garantirEspaco(ctx, 80);
      this.desenharCabecalhoAtendimento(ctx, tituloAtendimento, i + 1, atendimentos.length);
      const continuar = () => {
        this.novaPagina(ctx);
        this.desenharCabecalhoAtendimento(ctx, `${tituloAtendimento} (continuação)`, i + 1, atendimentos.length);
      };
      for (const [rotulo, texto] of secoes) {
        this.desenharSecaoClinica(ctx, rotulo, texto, continuar);
      }

      ctx.y -= 20;
    }

    // Rodapé final já é desenhado automaticamente em cada página
    this.desenharRodape(ctx);

    const bytes = await pdf.save();
    return Buffer.from(bytes);
  }

  private novaPagina(ctx: PdfContext): void {
    // Desenha rodapé da página anterior se existir
    if (ctx.pagina) {
      this.desenharRodape(ctx);
    }

    ctx.numeroPagina++;
    ctx.pagina = ctx.pdf.addPage([LARGURA_PAGINA, ALTURA_PAGINA]);
    ctx.y = ALTURA_PAGINA - MARGEM;

    this.desenharCabecalho(ctx);
  }

  private desenharCabecalho(ctx: PdfContext): void {
    const { pagina } = ctx;

    // Faixa verde no topo
    pagina.drawRectangle({
      x: 0,
      y: ALTURA_PAGINA - 70,
      width: LARGURA_PAGINA,
      height: 70,
      color: CORES.brandGreen,
    });

    // Linha escura de destaque
    pagina.drawRectangle({
      x: 0,
      y: ALTURA_PAGINA - 74,
      width: LARGURA_PAGINA,
      height: 4,
      color: CORES.brandDark,
    });

    // Marca vetorial usada também na interface.
    const marca = [
      'M56.36 138.5L87.15 54.01H107.36L137.56 138.5H56.36ZM79.63 121.81H113.59L96.79 71.87L79.63 121.81Z',
      'M98.05 15C143.84 15 181.1 52.26 181.1 98.05C181.1 143.84 143.84 181.1 98.05 181.1C52.26 181.1 15 143.84 15 98.05C15 52.26 52.26 15 98.05 15ZM98.05 0C43.9 0 0 43.9 0 98.05C0 152.2 43.9 196.1 98.05 196.1C152.2 196.1 196.1 152.2 196.1 98.05C196.1 43.9 152.2 0 98.05 0Z',
    ];
    for (const caminho of marca) {
      pagina.drawSvgPath(caminho, { x: LARGURA_PAGINA - MARGEM - 43, y: ALTURA_PAGINA - 12, scale: 0.22, color: CORES.brandDark });
    }

    // Título principal
    pagina.drawText('Instituto Ampara Animal', {
      x: MARGEM,
      y: ALTURA_PAGINA - 35,
      size: 16,
      font: ctx.fonteNegrito,
      color: CORES.brandDark,
    });

    // Subtítulo
    pagina.drawText('PRONTUÁRIO ANIMAL', {
      x: MARGEM,
      y: ALTURA_PAGINA - 55,
      size: 11,
      font: ctx.fonte,
      color: CORES.brandDark,
    });

    ctx.y = ALTURA_PAGINA - 100;
  }

  private desenharRodape(ctx: PdfContext): void {
    const { pagina, numeroPagina, dataGeracao } = ctx;

    // Linha separadora
    pagina.drawLine({
      start: { x: MARGEM, y: ALTURA_RODAPE + 10 },
      end: { x: LARGURA_PAGINA - MARGEM_DIREITA, y: ALTURA_RODAPE + 10 },
      thickness: 0.5,
      color: CORES.border,
    });

    // Número da página à esquerda
    pagina.drawText(`Página ${numeroPagina}`, {
      x: MARGEM,
      y: ALTURA_RODAPE - 5,
      size: 8,
      font: ctx.fonte,
      color: CORES.mutedForeground,
    });

    // Data de geração à direita
    const textoData = `Gerado em ${dataGeracao}`;
    const larguraTextoData = ctx.fonte.widthOfTextAtSize(textoData, 8);
    pagina.drawText(textoData, {
      x: LARGURA_PAGINA - MARGEM_DIREITA - larguraTextoData,
      y: ALTURA_RODAPE - 5,
      size: 8,
      font: ctx.fonte,
      color: CORES.mutedForeground,
    });
  }

  private garantirEspaco(ctx: PdfContext, altura: number): void {
    if (ctx.y - altura < MARGEM + ALTURA_RODAPE) {
      this.novaPagina(ctx);
    }
  }

  private desenharTituloSecao(ctx: PdfContext, titulo: string): void {
    this.garantirEspaco(ctx, 40);

    const { pagina } = ctx;

    // Fundo do título
    pagina.drawRectangle({
      x: MARGEM,
      y: ctx.y - 6,
      width: LARGURA_UTIL,
      height: 22,
      color: CORES.background,
    });

    // Barra lateral colorida
    pagina.drawRectangle({
      x: MARGEM,
      y: ctx.y - 6,
      width: 4,
      height: 22,
      color: CORES.primary,
    });

    // Texto do título
    pagina.drawText(sanitizarParaPdf(titulo), {
      x: MARGEM + 12,
      y: ctx.y,
      size: 12,
      font: ctx.fonteNegrito,
      color: CORES.foreground,
    });

    ctx.y -= 22;
  }

  private desenharCabecalhoAtendimento(ctx: PdfContext, titulo: string, numero: number, total: number): void {
    const { pagina } = ctx;

    // Fundo
    pagina.drawRectangle({
      x: MARGEM,
      y: ctx.y - 4,
      width: LARGURA_UTIL,
      height: 20,
      color: CORES.primary,
    });

    // Título
    pagina.drawText(sanitizarParaPdf(titulo), {
      x: MARGEM + 8,
      y: ctx.y + 2,
      size: 10,
      font: ctx.fonteNegrito,
      color: CORES.white,
    });

    // Contador
    const contador = `${numero}/${total}`;
    const larguraContador = ctx.fonte.widthOfTextAtSize(contador, 9);
    pagina.drawText(contador, {
      x: LARGURA_PAGINA - MARGEM_DIREITA - larguraContador - 8,
      y: ctx.y + 2,
      size: 9,
      font: ctx.fonte,
      color: CORES.white,
    });

    ctx.y -= 30;
  }

  private desenharSecaoClinica(ctx: PdfContext, rotulo: string, texto: string | null, continuar: () => void): void {
    if (ctx.y - 28 < ALTURA_RODAPE + 30) continuar();

    const { pagina } = ctx;

    // Rótulo da seção
    pagina.drawText(`${sanitizarParaPdf(rotulo)}:`, {
      x: MARGEM,
      y: ctx.y,
      size: 9,
      font: ctx.fonteNegrito,
      color: CORES.primary,
    });
    ctx.y -= 14;

    // Conteúdo
    const conteudo = texto?.trim() || '-';
    const largura = (parte: string) => ctx.fonte.widthOfTextAtSize(parte, 9);
    const linhas = quebrarTexto(conteudo, largura, LARGURA_UTIL - 8);

    for (const linha of linhas) {
      if (ctx.y - 14 < ALTURA_RODAPE + 30) {
        continuar();
        ctx.pagina.drawText(`${sanitizarParaPdf(rotulo)} (continuação):`, { x: MARGEM, y: ctx.y, size: 9, font: ctx.fonteNegrito, color: CORES.primary });
        ctx.y -= 14;
      }
      ctx.pagina.drawText(linha, {
        x: MARGEM + 8,
        y: ctx.y,
        size: 9,
        font: ctx.fonte,
        color: CORES.foreground,
      });
      ctx.y -= 12;
    }

    ctx.y -= 6;
  }

  private desenharCamposEmGrid(
    ctx: PdfContext,
    campos: Array<[string, string | null | undefined]>,
    colunas: number,
  ): void {
    const larguraCelula = LARGURA_UTIL / colunas;
    for (let inicio = 0; inicio < campos.length; inicio += colunas) {
      const linha = campos.slice(inicio, inicio + colunas).map(([rotulo, valor]) => ({
        rotulo,
        linhas: quebrarTexto(valor?.trim() || '-', (parte) => ctx.fonteNegrito.widthOfTextAtSize(parte, 10), larguraCelula - 12),
      }));
      const altura = 18 + Math.max(...linha.map((campo) => campo.linhas.length)) * 12;
      this.garantirEspaco(ctx, altura);
      linha.forEach((campo, coluna) => {
        const x = MARGEM + coluna * larguraCelula;
        ctx.pagina.drawText(`${sanitizarParaPdf(campo.rotulo)}:`, { x, y: ctx.y, size: 8, font: ctx.fonte, color: CORES.mutedForeground });
        campo.linhas.forEach((valor, indice) => {
          ctx.pagina.drawText(valor, { x, y: ctx.y - 11 - indice * 12, size: 10, font: ctx.fonteNegrito, color: CORES.foreground });
        });
      });
      ctx.y -= altura;
    }
  }

  private desenharCampo(ctx: PdfContext, rotulo: string, valor: string | null | undefined): void {
    this.garantirEspaco(ctx, 28);

    ctx.pagina.drawText(`${sanitizarParaPdf(rotulo)}:`, {
      x: MARGEM,
      y: ctx.y,
      size: 8,
      font: ctx.fonte,
      color: CORES.mutedForeground,
    });

    ctx.pagina.drawText(sanitizarParaPdf(valor && valor.length > 0 ? valor : '-'), {
      x: MARGEM,
      y: ctx.y - 11,
      size: 10,
      font: ctx.fonteNegrito,
      color: CORES.foreground,
    });

    ctx.y -= 28;
  }

  private desenharCampoLongo(ctx: PdfContext, rotulo: string, valor: string): void {
    this.garantirEspaco(ctx, 28);

    ctx.pagina.drawText(`${sanitizarParaPdf(rotulo)}:`, {
      x: MARGEM,
      y: ctx.y,
      size: 8,
      font: ctx.fonte,
      color: CORES.mutedForeground,
    });
    ctx.y -= 11;

    const largura = (parte: string) => ctx.fonte.widthOfTextAtSize(parte, 10);
    const linhas = quebrarTexto(valor, largura, LARGURA_UTIL);

    for (const linha of linhas) {
      this.garantirEspaco(ctx, 14);
      ctx.pagina.drawText(linha, {
        x: MARGEM,
        y: ctx.y,
        size: 10,
        font: ctx.fonteNegrito,
        color: CORES.foreground,
      });
      ctx.y -= 14;
    }

    ctx.y -= 4;
  }

  private escreverParagrafo(ctx: PdfContext, texto: string, tamanho: number, recuo = 0): void {
    const linhas = quebrarTexto(texto, (parte) => ctx.fonte.widthOfTextAtSize(parte, tamanho), LARGURA_UTIL - recuo);
    for (const linha of linhas) {
      this.garantirEspaco(ctx, tamanho + 6);
      this.escrever(ctx, linha, { tamanho, recuo });
      ctx.y -= tamanho + 6;
    }
  }

  private escrever(
    ctx: PdfContext,
    texto: string,
    opcoes: { negrito?: boolean; tamanho?: number; cor?: ReturnType<typeof rgb>; recuo?: number } = {},
  ): void {
    ctx.pagina.drawText(sanitizarParaPdf(texto), {
      x: MARGEM + (opcoes.recuo ?? 0),
      y: ctx.y,
      size: opcoes.tamanho ?? 10,
      font: opcoes.negrito ? ctx.fonteNegrito : ctx.fonte,
      color: opcoes.cor ?? CORES.foreground,
    });
  }
}
