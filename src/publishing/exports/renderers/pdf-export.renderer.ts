import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ExportBlock, ExportInline } from '../export.types';
import type { ExportDocument, RenderedExport } from '../export.types';
import type { ExportRenderer } from '../export-renderer.port';
import { exportAnchor } from '../export-toc';
import {
  SCENE_DIVIDER_COLOR,
  type SceneDividerVariant,
} from '../scene-divider';

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

function drawPdfPath(
  pdf: PDFKit.PDFDocument,
  path: string,
  fill = false,
  opacity?: number,
): void {
  if (opacity !== undefined) {
    pdf.opacity(opacity);
  }
  const shape = pdf.path(path);
  if (fill) {
    shape.fill(SCENE_DIVIDER_COLOR);
  } else {
    shape.stroke(SCENE_DIVIDER_COLOR);
  }
  if (opacity !== undefined) {
    pdf.opacity(1);
  }
}

function drawSceneDivider(
  pdf: PDFKit.PDFDocument,
  variant: SceneDividerVariant,
): void {
  const width = 460;
  const scale = width / 256;
  const height = 64 * scale;
  const state = pdf as unknown as { x: number; y: number };
  const x = state.x;
  const y = state.y + 8;

  pdf.save().translate(x, y).scale(scale);
  pdf.lineWidth(2.5).lineCap('round').lineJoin('round');

  if (variant === 'flourish') {
    drawPdfPath(pdf, 'M8 36c16-22 48-26 58-10 8 14-8 22-20 14-8-6-2-16 8-16');
    drawPdfPath(pdf, 'M56 36c24 0 44-14 66-16 16-2 24 6 24 16');
    drawPdfPath(
      pdf,
      'M248 36c-16-22-48-26-58-10-8 14 8 22 20 14 8-6 2-16-8-16',
    );
    drawPdfPath(pdf, 'M200 36c-24 0-44-14-66-16-16-2-24 6-24 16');
    drawPdfPath(pdf, 'M8 32h40M208 32h40M128 38v18');
    drawPdfPath(pdf, 'M128 6l8 16-8 12-8-12z', true, 0.82);
    pdf.circle(128, 38, 3.4).fill(SCENE_DIVIDER_COLOR);
    pdf.circle(114, 38, 1.8).fill(SCENE_DIVIDER_COLOR);
    pdf.circle(142, 38, 1.8).fill(SCENE_DIVIDER_COLOR);
  } else if (variant === 'diamonds') {
    drawPdfPath(
      pdf,
      'M8 32h70M248 32h-70M86 20l12 12-12 12M170 20l-12 12 12 12M102 32h52',
    );
    pdf.circle(108, 32, 3.4).fill(SCENE_DIVIDER_COLOR);
    pdf.circle(118, 32, 3.4).fill(SCENE_DIVIDER_COLOR);
    drawPdfPath(pdf, 'M128 14l16 18-16 18-16-18z', true, 0.18);
    drawPdfPath(pdf, 'M128 20l11 12-11 12-11-12z', true);
    pdf.circle(138, 32, 3.4).fill(SCENE_DIVIDER_COLOR);
    pdf.circle(148, 32, 3.4).fill(SCENE_DIVIDER_COLOR);
    drawPdfPath(pdf, 'M128 20l11 12-11 12-11-12z');
  } else if (variant === 'stars') {
    pdf.dash(2, { space: 8 });
    drawPdfPath(pdf, 'M8 32h80M168 32h80');
    pdf.undash();
    drawPdfPath(
      pdf,
      'M128 6l5.4 16.6h16.6l-13.4 10.2 5 16.4-13.6-9.8-13.6 9.8 5-16.4L106 22.6h16.6z',
      true,
    );
    drawPdfPath(
      pdf,
      'M92 18l3.2 9.6h10.2l-8.2 6 3.2 9.8-8.4-6-8.2 6 3.2-9.8-8.2-6h10.2z',
      true,
      0.7,
    );
    drawPdfPath(
      pdf,
      'M164 18l3.2 9.6h10.2l-8.2 6 3.2 9.8-8.4-6-8.2 6 3.2-9.8-8.2-6h10.2z',
      true,
      0.7,
    );
  } else {
    drawPdfPath(pdf, 'M8 46c36 0 72-10 120-18');
    drawPdfPath(pdf, 'M248 46c-36 0-72-10-120-18');
    drawPdfPath(pdf, 'M114 28c6 0 10 6 14 10 4-4 8-10 14-10');
    drawPdfPath(pdf, 'M36 42c-4-12-14-18-24-18 4 10 12 16 24 18z');
    drawPdfPath(pdf, 'M50 40c0 10-6 16-16 20 0-10 6-16 16-20z');
    drawPdfPath(pdf, 'M62 38c-2-12-10-18-20-22 2 10 8 18 20 22z');
    drawPdfPath(pdf, 'M78 36c0 10-6 16-16 20 0-10 6-16 16-20z');
    drawPdfPath(pdf, 'M92 34c-2-10-10-16-20-20 2 10 8 16 20 20z');
    drawPdfPath(pdf, 'M220 42c4-12 14-18 24-18-4 10-12 16-24 18z');
    drawPdfPath(pdf, 'M206 40c0 10 6 16 16 20 0-10-6-16-16-20z');
    drawPdfPath(pdf, 'M194 38c2-12 10-18 20-22-2 10-8 18-20 22z');
    drawPdfPath(pdf, 'M178 36c0 10 6 16 16 20 0-10-6-16-16-20z');
    drawPdfPath(pdf, 'M164 34c2-10 10-16 20-20-2 10-8 16-20 20z');
  }

  pdf.restore();
  state.y = y + height + 8;
}

function renderBlocks(
  pdf: PDFKit.PDFDocument,
  blocks: ExportBlock[],
  listPrefix = '',
): void {
  for (const block of blocks) {
    if (
      block.kind === 'paragraph' ||
      block.kind === 'heading' ||
      block.kind === 'blockquote' ||
      block.kind === 'codeBlock'
    ) {
      const size =
        block.kind === 'heading'
          ? Math.max(12, 22 - (block.level ?? 1) * 2)
          : block.kind === 'codeBlock'
            ? 9
            : 11;
      pdf.fontSize(size);
      if (block.kind === 'codeBlock') {
        pdf.font('Courier');
      }
      if (block.kind === 'blockquote') {
        pdf.font('Helvetica-Oblique');
      }
      renderInlineRuns(pdf, block.inlines, {
        ...textOptions(block),
        indent:
          textOptions(block).indent + (block.kind === 'blockquote' ? 20 : 0),
      });
      pdf.font('Helvetica');
      continue;
    }

    if (block.kind === 'image') {
      pdf.image(block.image.buffer, {
        fit: [460, 320],
        align: 'center',
      });
      pdf.moveDown(0.5);
      continue;
    }

    if (block.kind === 'sceneDivider') {
      drawSceneDivider(pdf, block.variant);
      continue;
    }

    if (block.kind === 'horizontalRule') {
      const state = pdf as unknown as { x: number; y: number };
      pdf
        .moveTo(state.x, state.y + 4)
        .lineTo(535, state.y + 4)
        .lineWidth(0.75)
        .stroke('#808080');
      state.y += 14;
      continue;
    }

    block.items.forEach((item, index) => {
      const prefix = block.kind === 'bulletList' ? '• ' : `${index + 1}. `;
      if (item[0]?.kind === 'paragraph') {
        const first = item[0];
        pdf.fontSize(11).text(`${prefix}${plainText(first.inlines)}`, {
          indent: 18,
          paragraphGap: 4,
        });
        renderBlocks(pdf, item.slice(1), listPrefix);
      } else {
        pdf.fontSize(11).text(`${prefix}`, { indent: 18, continued: true });
        renderBlocks(pdf, item, listPrefix);
      }
    });
  }
}

function renderToc(pdf: PDFKit.PDFDocument, document: ExportDocument): void {
  pdf.font('Helvetica').fontSize(17).text('Índice').moveDown(0.5);

  for (const entry of document.toc) {
    pdf
      .fontSize(entry.level === 0 ? 12 : 11)
      .text(entry.title, {
        indent: entry.level * 18,
        goTo: entry.anchor,
      })
      .moveDown(0.18);
  }
}

@Injectable()
export class PdfExportRenderer implements ExportRenderer {
  readonly format = 'PDF' as const;

  async render(document: ExportDocument): Promise<RenderedExport> {
    const pdf = new PDFDocument({
      size: 'A4',
      margin: 60,
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
        destination: exportAnchor('project', document.id),
      })
      .moveDown(1);

    renderToc(pdf, document);
    pdf.addPage();

    document.books.forEach((book, bookIndex) => {
      if (bookIndex > 0) {
        pdf.addPage();
      }
      pdf
        .fontSize(19)
        .text(book.title, {
          align: 'center',
          destination: exportAnchor('book', book.id),
        })
        .moveDown(0.75);
      book.chapters.forEach((chapter, chapterIndex) => {
        if (chapterIndex > 0) {
          pdf.addPage();
        }
        pdf
          .fontSize(15)
          .text(chapter.title, {
            destination: exportAnchor('chapter', chapter.id),
          })
          .moveDown(0.4);
        for (const scene of chapter.scenes) {
          if (scene.title) {
            pdf
              .fontSize(13)
              .text(scene.title, {
                destination: exportAnchor('scene', scene.id),
              })
              .moveDown(0.25);
          }
          renderBlocks(pdf, scene.content);
        }
      });
    });
    pdf.end();

    return {
      buffer: await result,
      contentType: 'application/pdf',
      extension: 'PDF',
    };
  }
}
