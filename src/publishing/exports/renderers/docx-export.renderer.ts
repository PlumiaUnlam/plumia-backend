import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Bookmark,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import type { ExportRenderer } from '../export-renderer.port';
import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  ExportInline,
  ExportTextBlock,
  RenderedExport,
} from '../export.types';
import { normalizeExportIndentation } from '../export-indentation';
import { exportAnchor } from '../export-toc';
import { sceneDividerPngFallback, sceneDividerSvg } from '../scene-divider';

function imageType(image: ExportImage): 'jpg' | 'png' | 'gif' | 'bmp' {
  if (image.extension === 'png') {
    return 'png';
  }
  if (image.extension === 'gif') {
    return 'gif';
  }
  if (image.extension === 'bmp') {
    return 'bmp';
  }
  return 'jpg';
}

function heading(
  level: number | undefined,
): (typeof HeadingLevel)[keyof typeof HeadingLevel] | undefined {
  if (level === 1) {
    return HeadingLevel.HEADING_1;
  }
  if (level === 2) {
    return HeadingLevel.HEADING_2;
  }
  if (level === 3) {
    return HeadingLevel.HEADING_3;
  }
  return undefined;
}

function alignment(
  value: string | undefined,
): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  if (value === 'center') {
    return AlignmentType.CENTER;
  }
  if (value === 'right') {
    return AlignmentType.RIGHT;
  }
  if (value === 'justify') {
    return AlignmentType.JUSTIFIED;
  }
  if (value === 'left') {
    return AlignmentType.LEFT;
  }
  return undefined;
}

function inlineRuns(inlines: ExportInline[]): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const inline of inlines) {
    if (inline.kind === 'break') {
      children.push(new TextRun({ break: 1 }));
      continue;
    }

    const run = new TextRun({
      text: inline.text,
      bold: inline.bold,
      italics: inline.italic,
    });
    children.push(
      inline.href
        ? new ExternalHyperlink({ children: [run], link: inline.href })
        : run,
    );
  }

  return children;
}

function paragraphOptions(
  block: ExportTextBlock,
  children: ParagraphChild[] = inlineRuns(block.inlines),
  bullet?: boolean,
  additionalLeftCm = 0,
): IParagraphOptions {
  const blockHeading = heading(block.level);
  const blockAlignment = alignment(block.textAlign);
  const lineHeight = block.lineHeight ? Number(block.lineHeight) : NaN;
  const indentation = normalizeExportIndentation({
    indentLeft: (block.indentLeft ?? 0) + additionalLeftCm,
    indentRight: block.indentRight,
    firstLineIndent: block.firstLineIndent,
  });

  return {
    children,
    ...(blockHeading ? { heading: blockHeading } : {}),
    ...(blockAlignment ? { alignment: blockAlignment } : {}),
    ...(bullet ? { bullet: { level: 0 } } : {}),
    ...(indentation.indentLeft ||
    indentation.indentRight ||
    indentation.firstLineIndent
      ? {
          indent: {
            ...(indentation.indentLeft
              ? { left: Math.round(indentation.indentLeft * 567) }
              : {}),
            ...(indentation.indentRight
              ? { right: Math.round(indentation.indentRight * 567) }
              : {}),
            ...(indentation.firstLineIndent
              ? { firstLine: Math.round(indentation.firstLineIndent * 567) }
              : {}),
          },
        }
      : {}),
    ...(Number.isFinite(lineHeight)
      ? { spacing: { line: Math.round(lineHeight * 240) } }
      : {}),
  };
}

function textBlockParagraph(block: ExportTextBlock): Paragraph {
  if (block.kind === 'codeBlock') {
    const children = block.inlines.map((inline) =>
      inline.kind === 'break'
        ? new TextRun({ break: 1 })
        : new TextRun({ text: inline.text, font: 'Courier New' }),
    );
    return new Paragraph(paragraphOptions(block, children));
  }

  if (block.kind === 'blockquote') {
    const children = block.inlines.map((inline) =>
      inline.kind === 'break'
        ? new TextRun({ break: 1 })
        : new TextRun({
            text: inline.text,
            bold: inline.bold,
            italics: true,
          }),
    );
    return new Paragraph({
      ...paragraphOptions(block, children, undefined, 720 / 567),
    });
  }

  return new Paragraph(paragraphOptions(block));
}

function blocksToParagraphs(blocks: ExportBlock[]): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const block of blocks) {
    if (
      block.kind === 'paragraph' ||
      block.kind === 'heading' ||
      block.kind === 'blockquote' ||
      block.kind === 'codeBlock'
    ) {
      paragraphs.push(textBlockParagraph(block));
      continue;
    }

    if (block.kind === 'image') {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: imageType(block.image),
              data: block.image.buffer,
              transformation: { width: 450, height: 300 },
              altText: {
                title: block.alt,
                description: block.alt,
                name: block.alt,
              },
            }),
          ],
        }),
      );
      continue;
    }

    if (block.kind === 'sceneDivider') {
      paragraphs.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 120, after: 120 },
          children: [
            new ImageRun({
              type: 'svg',
              data: Buffer.from(sceneDividerSvg(block.variant), 'utf8'),
              fallback: {
                type: 'png',
                data: sceneDividerPngFallback(block.variant),
              },
              transformation: { width: 360, height: 90 },
              altText: {
                title: 'Separador ornamental',
                description: 'Separador ornamental',
                name: 'Separador ornamental',
              },
            }),
          ],
        }),
      );
      continue;
    }

    if (block.kind === 'horizontalRule') {
      paragraphs.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: {
            bottom: {
              color: '808080',
              style: BorderStyle.SINGLE,
              size: 6,
              space: 1,
            },
          },
        }),
      );
      continue;
    }

    const bullet = block.kind === 'bulletList';
    for (const item of block.items) {
      const firstParagraph = item.find(
        (
          child,
        ): child is Extract<ExportBlock, { kind: 'paragraph' | 'heading' }> =>
          child.kind === 'paragraph' || child.kind === 'heading',
      );

      if (firstParagraph) {
        paragraphs.push(
          new Paragraph(paragraphOptions(firstParagraph, undefined, bullet)),
        );
        paragraphs.push(
          ...blocksToParagraphs(
            item.filter((child) => child !== firstParagraph),
          ),
        );
      } else {
        paragraphs.push(new Paragraph({ text: bullet ? '•' : '1.' }));
        paragraphs.push(...blocksToParagraphs(item));
      }
    }
  }

  return paragraphs;
}

function bookmarkedHeading(
  title: string,
  headingLevel: IParagraphOptions['heading'],
  anchor: string,
): Paragraph {
  return new Paragraph({
    ...(headingLevel ? { heading: headingLevel } : {}),
    children: [
      new Bookmark({
        id: anchor,
        children: [new TextRun({ text: title })],
      }),
    ],
  });
}

function tocParagraph(entry: ExportDocument['toc'][number]): Paragraph {
  return new Paragraph({
    indent: { left: entry.level * 360 },
    children: [
      new InternalHyperlink({
        anchor: entry.anchor,
        children: [new TextRun({ text: entry.title, style: 'Hyperlink' })],
      }),
    ],
  });
}

@Injectable()
export class DocxExportRenderer implements ExportRenderer {
  readonly format = 'DOCX' as const;

  async render(document: ExportDocument): Promise<RenderedExport> {
    const children: Paragraph[] = [
      bookmarkedHeading(
        document.title,
        HeadingLevel.TITLE,
        exportAnchor('project', document.id),
      ),
      new Paragraph({
        text: 'Índice',
        heading: HeadingLevel.HEADING_1,
      }),
      ...document.toc.map(tocParagraph),
      new Paragraph({ children: [new PageBreak()] }),
    ];

    document.books.forEach((book, bookIndex) => {
      if (bookIndex > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(
        bookmarkedHeading(
          book.title,
          HeadingLevel.HEADING_1,
          exportAnchor('book', book.id),
        ),
      );
      book.chapters.forEach((chapter, chapterIndex) => {
        if (chapterIndex > 0) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
        }
        children.push(
          bookmarkedHeading(
            chapter.title,
            HeadingLevel.HEADING_2,
            exportAnchor('chapter', chapter.id),
          ),
        );
        for (const scene of chapter.scenes) {
          if (scene.title) {
            children.push(
              bookmarkedHeading(
                scene.title,
                HeadingLevel.HEADING_3,
                exportAnchor('scene', scene.id),
              ),
            );
          }
          children.push(...blocksToParagraphs(scene.content));
        }
      });
    });

    const file = new Document({ sections: [{ children }] });
    return {
      buffer: await Packer.toBuffer(file),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'DOCX',
    };
  }
}
