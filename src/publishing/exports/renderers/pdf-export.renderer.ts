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
import { buildExportToc, exportAnchor } from '../export-toc';
import type { SceneDividerVariant } from '../scene-divider';

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
    renderSceneDivider(pdf, block.variant);
    return;
  }
  if (block.kind === 'horizontalRule') {
    renderHorizontalRule(pdf);
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

function renderSceneDivider(
  pdf: PDFKit.PDFDocument,
  variant: SceneDividerVariant,
): void {
  const width = Math.min(
    256,
    pdf.page.width - pdf.page.margins.left - pdf.page.margins.right,
  );
  const scale = width / 256;
  const x = (pdf.page.width - width) / 2;
  const y = pdf.y + 4;
  const color = '#5b3d6f';

  pdf.save().translate(x, y).scale(scale);
  pdf.lineWidth(2.5).strokeColor(color).lineCap('round').lineJoin('round');

  if (variant === 'flourish') {
    pdf
      .path('M8 36 C24 14 56 10 66 26 C74 40 58 48 46 40 C38 34 44 24 54 24')
      .stroke();
    pdf.path('M56 36 C80 36 100 22 122 20 C138 18 146 26 146 36').stroke();
    pdf
      .path(
        'M248 36 C232 14 200 10 190 26 C182 40 198 48 210 40 C218 34 212 24 202 24',
      )
      .stroke();
    pdf.path('M200 36 C176 36 156 22 134 20 C118 18 110 26 110 36').stroke();
    pdf.moveTo(8, 32).lineTo(48, 32).stroke();
    pdf.moveTo(208, 32).lineTo(248, 32).stroke();
    pdf.path('M128 6 L136 22 L128 34 L120 22 Z').fill(color);
    pdf.circle(128, 38, 3.4).fill(color);
    pdf.circle(114, 38, 1.8).fill(color);
    pdf.circle(142, 38, 1.8).fill(color);
  } else if (variant === 'diamonds') {
    pdf.moveTo(8, 32).lineTo(78, 32).stroke();
    pdf.moveTo(248, 32).lineTo(178, 32).stroke();
    pdf
      .path('M86 20 L98 32 L86 44 M170 20 L158 32 L170 44 M102 32 L154 32')
      .stroke();
    for (const cx of [108, 118, 138, 148]) {
      pdf.circle(cx, 32, 3.4).fill(color);
    }
    pdf.path('M128 14 L144 32 L128 50 L112 32 Z').fillOpacity(0.18).fill(color);
    pdf.fillOpacity(1);
    pdf.path('M128 20 L139 32 L128 44 L117 32 Z').fill(color);
    pdf.path('M128 20 L139 32 L128 44 L117 32 Z').stroke();
  } else if (variant === 'stars') {
    pdf.dash(2, { space: 8 });
    pdf.moveTo(8, 32).lineTo(88, 32).stroke();
    pdf.moveTo(168, 32).lineTo(248, 32).stroke();
    pdf.undash();
    pdf
      .path(
        'M128 6 L133.4 22.6 L150 22.6 L136.6 32.8 L141.6 49.2 L128 39.4 L114.4 49.2 L119.4 32.8 L106 22.6 L122.6 22.6 Z',
      )
      .fill(color);
    pdf
      .path(
        'M92 18 L95.2 27.6 L105.4 27.6 L97.2 33.6 L100.4 43.4 L92 37.4 L83.8 43.4 L87 33.6 L78.8 27.6 L89 27.6 Z',
      )
      .fillOpacity(0.7)
      .fill(color);
    pdf
      .path(
        'M164 18 L167.2 27.6 L177.4 27.6 L169.2 33.6 L172.4 43.4 L164 37.4 L155.8 43.4 L159 33.6 L150.8 27.6 L161 27.6 Z',
      )
      .fillOpacity(0.7)
      .fill(color);
  } else {
    pdf.path('M8 46 C44 46 80 36 128 28').stroke();
    pdf.path('M248 46 C212 46 176 36 128 28').stroke();
    pdf.path('M114 28 C120 28 124 34 128 38 C132 34 136 28 142 28').stroke();
    pdf.path('M36 42 C32 30 22 24 12 24 C16 34 24 40 36 42 Z').stroke();
    pdf.path('M50 40 C50 50 44 56 34 60 C34 50 40 44 50 40 Z').stroke();
    pdf.path('M62 38 C60 26 52 20 42 16 C44 26 50 34 62 38 Z').stroke();
    pdf.path('M78 36 C78 46 72 52 62 56 C62 46 68 40 78 36 Z').stroke();
    pdf.path('M92 34 C90 24 82 18 72 14 C74 24 80 32 92 34 Z').stroke();
    pdf.path('M220 42 C224 30 234 24 244 24 C240 34 232 40 220 42 Z').stroke();
    pdf.path('M206 40 C206 50 212 56 222 60 C222 50 216 44 206 40 Z').stroke();
    pdf.path('M194 38 C196 26 204 20 214 16 C212 26 206 34 194 38 Z').stroke();
    pdf.path('M178 36 C178 46 184 52 194 56 C194 46 188 40 178 36 Z').stroke();
    pdf.path('M164 34 C166 24 174 18 184 14 C182 24 176 32 164 34 Z').stroke();
  }

  pdf.restore();
  pdf.y = y + 64 * scale + 8;
}

function renderHorizontalRule(pdf: PDFKit.PDFDocument): void {
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
      .text(document.title, {
        align: 'center',
        destination: exportAnchor('book', document.id),
      })
      .moveDown(1);
    // La portada queda sola en la página 1; el contenido siempre arranca en la 2.
    pdf.addPage();
    pdf.font('Helvetica').fontSize(20).text('Índice').moveDown(0.8);
    for (const entry of buildExportToc(document)) {
      const indent = entry.level * 18;
      const y = pdf.y;
      pdf
        .fontSize(entry.level === 0 ? 12 : 11)
        .text(entry.title, margins.left + indent, y, {
          width: pdf.page.width - margins.left - margins.right - indent,
          goTo: entry.anchor,
        });
      pdf.moveDown(0.25);
    }
    pdf.addPage();
    document.chapters.forEach((chapter, chapterIndex) => {
      if (chapterIndex > 0) {
        pdf.addPage();
      }
      pdf
        .fontSize(15)
        .text(chapter.title, {
          destination: exportAnchor('chapter', chapter.id),
        })
        .moveDown(0.4);
      chapter.scenes.forEach((scene, sceneIndex) => {
        if (scene.title) {
          pdf
            .fontSize(13)
            .text(scene.title, {
              destination: exportAnchor('scene', scene.id),
            })
            .moveDown(0.25);
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
