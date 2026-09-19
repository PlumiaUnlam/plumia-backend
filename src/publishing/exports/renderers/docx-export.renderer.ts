import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
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
): IParagraphOptions {
  const blockHeading = heading(block.level);
  const blockAlignment = alignment(block.textAlign);
  const lineHeight = block.lineHeight ? Number(block.lineHeight) : NaN;

  return {
    children,
    ...(blockHeading ? { heading: blockHeading } : {}),
    ...(blockAlignment ? { alignment: blockAlignment } : {}),
    ...(bullet ? { bullet: { level: 0 } } : {}),
    ...(block.indentLeft || block.indentRight || block.firstLineIndent
      ? {
          indent: {
            ...(block.indentLeft
              ? { left: Math.round(block.indentLeft * 567) }
              : {}),
            ...(block.indentRight
              ? { right: Math.round(block.indentRight * 567) }
              : {}),
            ...(block.firstLineIndent
              ? { firstLine: Math.round(block.firstLineIndent * 567) }
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
      ...paragraphOptions(block, children),
      indent: { left: 720 },
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
        new Paragraph({ text: '⁂', alignment: AlignmentType.CENTER }),
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

@Injectable()
export class DocxExportRenderer implements ExportRenderer {
  readonly format = 'DOCX' as const;

  async render(document: ExportDocument): Promise<RenderedExport> {
    const children: Paragraph[] = [
      new Paragraph({ text: document.title, heading: HeadingLevel.TITLE }),
    ];

    for (const book of document.books) {
      children.push(
        new Paragraph({ text: book.title, heading: HeadingLevel.HEADING_1 }),
      );
      for (const chapter of book.chapters) {
        children.push(
          new Paragraph({
            text: chapter.title,
            heading: HeadingLevel.HEADING_2,
          }),
        );
        for (const scene of chapter.scenes) {
          if (scene.title) {
            children.push(
              new Paragraph({
                text: scene.title,
                heading: HeadingLevel.HEADING_3,
              }),
            );
          }
          children.push(...blocksToParagraphs(scene.content));
        }
      }
    }

    const file = new Document({ sections: [{ children }] });
    return {
      buffer: await Packer.toBuffer(file),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'DOCX',
    };
  }
}
