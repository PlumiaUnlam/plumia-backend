import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type {
  ExportBlock,
  ExportDocument,
  ExportInline,
  RenderedExport,
} from '../export.types';
import type { ExportRenderer } from '../export-renderer.port';
import type {
  ExportHeaderFooterConfig,
  ExportSettingsConfig,
} from '../export-settings.types';
import { resolveTemplate } from '../export-settings.defaults';

const CM_TO_PT = 28.35;
// Distancia fija desde el borde físico de la página hasta el header/footer —
// independiente del margen configurado por el usuario, igual que en un
// procesador de texto tradicional (el margen solo controla dónde arranca
// el cuerpo del texto).
const HEADER_DISTANCE_PT = 24;
const FOOTER_DISTANCE_PT = 24;
// Alto reservado para el texto del header/footer (evita que se superponga
// con el cuerpo cuando el margen configurado es menor a este mínimo).
const HEADER_FOOTER_TEXT_HEIGHT_PT = 20;

function plainText(inlines: ExportInline[]): string {
  return inlines
    .map((inline) => (inline.kind === 'break' ? '\n' : inline.text))
    .join('');
}

function textOptions(
  block: Extract<ExportBlock, { inlines: ExportInline[] }>,
): {
  align: 'left' | 'center' | 'right' | 'justify';
  indent: number;
  paragraphGap: number;
  lineGap: number;
} {
  return {
    align:
      block.textAlign === 'center' ||
      block.textAlign === 'right' ||
      block.textAlign === 'justify'
        ? block.textAlign
        : 'left',
    indent: (block.indentLeft ?? 0) * 28.35,
    paragraphGap: 6,
    lineGap: block.lineHeight
      ? Math.max(0, (Number(block.lineHeight) - 1) * 6)
      : 0,
  } as const;
}

function renderInlineRuns(
  pdf: PDFKit.PDFDocument,
  inlines: ExportInline[],
  options: ReturnType<typeof textOptions>,
): void {
  if (inlines.length === 0) {
    pdf.text('', options);
    return;
  }

  inlines.forEach((inline, index) => {
    if (inline.kind === 'break') {
      pdf.text('\n', { continued: index < inlines.length - 1 });
      return;
    }
    pdf.font(
      inline.bold || inline.italic ? 'Helvetica-BoldOblique' : 'Helvetica',
    );
    pdf.text(inline.text, {
      ...options,
      link: inline.href,
      continued: index < inlines.length - 1,
    });
  });
  pdf.font('Helvetica');
  pdf.moveDown(0.35);
}

function renderBlocks(pdf: PDFKit.PDFDocument, blocks: ExportBlock[]): void {
  for (const block of blocks) {
    renderBlock(pdf, block);
  }
}

function renderBlock(pdf: PDFKit.PDFDocument, block: ExportBlock): void {
  if (
    block.kind === 'paragraph' ||
    block.kind === 'heading' ||
    block.kind === 'blockquote' ||
    block.kind === 'codeBlock'
  ) {
    renderTextBlock(pdf, block);
    return;
  }
  if (block.kind === 'image') {
    pdf.image(block.image.buffer, { fit: [460, 320], align: 'center' });
    pdf.moveDown(0.5);
    return;
  }
  if (block.kind === 'sceneDivider') {
    renderSceneDivider(pdf);
    return;
  }
  renderListBlock(pdf, block);
}

function renderTextBlock(
  pdf: PDFKit.PDFDocument,
  block: Extract<ExportBlock, { inlines: ExportInline[] }>,
): void {
  pdf.fontSize(fontSizeForBlock(block));
  if (block.kind === 'codeBlock') {
    pdf.font('Courier');
  }
  if (block.kind === 'blockquote') {
    pdf.font('Helvetica-Oblique');
  }
  const options = textOptions(block);
  renderInlineRuns(pdf, block.inlines, {
    ...options,
    indent: options.indent + (block.kind === 'blockquote' ? 20 : 0),
  });
  pdf.font('Helvetica');
}

function fontSizeForBlock(
  block: Extract<ExportBlock, { inlines: ExportInline[] }>,
): number {
  if (block.kind === 'heading') {
    return Math.max(12, 22 - (block.level ?? 1) * 2);
  }
  return block.kind === 'codeBlock' ? 9 : 11;
}

function renderSceneDivider(pdf: PDFKit.PDFDocument): void {
  // Línea vectorial real para evitar caracteres que Helvetica no soporta.
  const y = pdf.y + 6;
  pdf
    .moveTo(pdf.page.margins.left, y)
    .lineTo(pdf.page.width - pdf.page.margins.right, y)
    .lineWidth(1)
    .strokeColor('#333333')
    .stroke();
  pdf.y = y + 14;
}

function renderListBlock(
  pdf: PDFKit.PDFDocument,
  block: Extract<ExportBlock, { kind: 'bulletList' | 'orderedList' }>,
): void {
  block.items.forEach((item, index) => {
    const prefix = block.kind === 'bulletList' ? '• ' : `${index + 1}. `;
    if (item[0]?.kind === 'paragraph') {
      const first = item[0];
      pdf.fontSize(11).text(`${prefix}${plainText(first.inlines)}`, {
        indent: 18,
        paragraphGap: 4,
      });
      renderBlocks(pdf, item.slice(1));
      return;
    }
    pdf.fontSize(11).text(`${prefix}`, { indent: 18, continued: true });
    renderBlocks(pdf, item);
  });
}

function drawBand(
  pdf: PDFKit.PDFDocument,
  config: ExportHeaderFooterConfig | null,
  vars: Record<string, string>,
  position: 'top' | 'bottom',
  margins: { top: number; bottom: number; left: number; right: number },
): void {
  if (!config || (!config.text && !config.pageNumber.enabled)) {
    return;
  }

  const parts: string[] = [];
  if (config.text) {
    parts.push(resolveTemplate(config.text, vars));
  }
  if (config.pageNumber.enabled) {
    parts.push(resolveTemplate(config.pageNumber.format, vars));
  }
  const text = parts.join('  ');

  const pageWidth = pdf.page.width;
  const pageHeight = pdf.page.height;
  // Posición fija respecto al borde físico de la página: no depende del
  // margen configurado por el usuario.
  const y =
    position === 'top' ? HEADER_DISTANCE_PT : pageHeight - FOOTER_DISTANCE_PT;

  // `height` acota el cuadro de texto para que pdfkit no interprete que el
  // contenido "desborda" la página y dispare su paginación automática
  // (lo que agregaba hojas en blanco al final del documento).
  pdf.fontSize(9).text(text, margins.left, y, {
    width: pageWidth - margins.left - margins.right,
    height: HEADER_FOOTER_TEXT_HEIGHT_PT,
    align: config.alignment,
    lineBreak: false,
  });
}

@Injectable()
export class PdfExportRenderer implements ExportRenderer {
  readonly format = 'PDF' as const;

  async render(
    document: ExportDocument,
    settings: ExportSettingsConfig,
  ): Promise<RenderedExport> {
    // El margen real nunca es menor al necesario para que el header/footer
    // (a distancia fija del borde) no se superponga con el cuerpo — igual
    // que el comportamiento automático de Word cuando la distancia del
    // encabezado es mayor al margen configurado.
    const margins = {
      top: Math.max(
        settings.margins.topCm * CM_TO_PT,
        settings.header ? HEADER_DISTANCE_PT + HEADER_FOOTER_TEXT_HEIGHT_PT : 0,
      ),
      bottom: Math.max(
        settings.margins.bottomCm * CM_TO_PT,
        settings.footer ? FOOTER_DISTANCE_PT + HEADER_FOOTER_TEXT_HEIGHT_PT : 0,
      ),
      left: settings.margins.leftCm * CM_TO_PT,
      right: settings.margins.rightCm * CM_TO_PT,
    };

    const pdf = new PDFDocument({
      size: 'A4',
      margins,
      bufferPages: true,
      info: { Title: document.title },
    });
    const chunks: Buffer[] = [];
    const result = new Promise<Buffer>((resolve, reject) => {
      pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
      pdf.on('end', () => resolve(Buffer.concat(chunks)));
      pdf.on('error', reject);
    });

    pdf
      .font('Helvetica')
      .fontSize(24)
      .text(document.title, { align: 'center' })
      .moveDown(1);
    // La portada queda sola en la página 1; el contenido siempre arranca en la 2.
    pdf.addPage();
    document.chapters.forEach((chapter, chapterIndex) => {
      if (chapterIndex > 0) {
        pdf.addPage();
      }
      pdf.fontSize(15).text(chapter.title).moveDown(0.4);
      chapter.scenes.forEach((scene, sceneIndex) => {
        if (scene.title) {
          pdf.fontSize(13).text(scene.title).moveDown(0.25);
        }
        renderBlocks(pdf, scene.content);
        if (sceneIndex < chapter.scenes.length - 1) {
          pdf.addPage();
        }
      });
    });

    if (settings.header || settings.footer) {
      const vars = {
        tituloLibro: document.title,
        fecha: new Date().toLocaleDateString('es'),
      };
      const range = pdf.bufferedPageRange();
      // La página 1 (portada) nunca lleva header/footer ni entra en la
      // numeración: "Página 1" corresponde a la primera página de contenido.
      const contentStart = range.start + 1;
      const totalContentPages = range.count - 1;
      for (let i = contentStart; i < range.start + range.count; i++) {
        pdf.switchToPage(i);
        const pageVars = {
          ...vars,
          pagina: String(i - contentStart + 1),
          totalPaginas: String(totalContentPages),
        };
        drawBand(pdf, settings.header, pageVars, 'top', margins);
        drawBand(pdf, settings.footer, pageVars, 'bottom', margins);
      }
    }

    pdf.end();

    return {
      buffer: await result,
      contentType: 'application/pdf',
      extension: 'PDF',
    };
  }
}
