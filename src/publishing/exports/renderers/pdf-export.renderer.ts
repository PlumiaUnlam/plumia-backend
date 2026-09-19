import { Injectable } from '@nestjs/common';
import PDFDocument from 'pdfkit';
import type { ExportBlock, ExportInline } from '../export.types';
import type { ExportDocument, RenderedExport } from '../export.types';
import type { ExportRenderer } from '../export-renderer.port';

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
      pdf.fontSize(16).text('⁂', { align: 'center' }).moveDown(0.5);
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
      .text(document.title, { align: 'center' })
      .moveDown(1);
    document.books.forEach((book, bookIndex) => {
      if (bookIndex > 0) {
        pdf.addPage();
      }
      pdf.fontSize(19).text(book.title, { align: 'center' }).moveDown(0.75);
      for (const chapter of book.chapters) {
        pdf.fontSize(15).text(chapter.title).moveDown(0.4);
        for (const scene of chapter.scenes) {
          if (scene.title) {
            pdf.fontSize(13).text(scene.title).moveDown(0.25);
          }
          renderBlocks(pdf, scene.content);
        }
      }
    });
    pdf.end();

    return {
      buffer: await result,
      contentType: 'application/pdf',
      extension: 'PDF',
    };
  }
}
