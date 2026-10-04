import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Bookmark,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  InternalHyperlink,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import type { ExportRenderer } from '../export-renderer.port';
import type {
  ExportHeaderFooterConfig,
  ExportSettingsConfig,
} from '../export-settings.types';
import { resolveTemplate } from '../export-settings.defaults';
import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  ExportInline,
  ExportTextBlock,
  RenderedExport,
} from '../export.types';
import { buildExportToc, exportAnchor } from '../export-toc';
import { sceneDividerPngFallback, sceneDividerSvg } from '../scene-divider';

const CM_TO_TWIPS = 567;
// Distancia fija (en twips) desde el borde de la página al header/footer,
// independiente del margen configurado — mismo valor que PDF (24pt) para
// consistencia visual entre formatos. Sin esto, Word usa su propio default
// implícito (~1.25cm), que puede variar según el visor (Word/LibreOffice).
const HEADER_FOOTER_DISTANCE_TWIPS = 480;

function bandChildren(
  config: ExportHeaderFooterConfig,
  vars: Record<string, string>,
): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  if (config.text) {
    children.push(new TextRun(resolveTemplate(config.text, vars)));
  }

  if (config.pageNumber.enabled) {
    if (children.length > 0) {
      children.push(new TextRun('  '));
    }
    const [before, afterTotal] =
      config.pageNumber.format.split('{{totalPaginas}}');
    const [beforeCurrent, afterCurrent] = (before ?? '').split('{{pagina}}');
    if (beforeCurrent) {
      children.push(new TextRun(resolveTemplate(beforeCurrent, vars)));
    }
    children.push(new TextRun({ children: [PageNumber.CURRENT] }));
    if (afterTotal !== undefined) {
      if (afterCurrent) {
        children.push(new TextRun(resolveTemplate(afterCurrent, vars)));
      }
      children.push(
        new TextRun({ children: [PageNumber.TOTAL_PAGES_IN_SECTION] }),
      );
      if (afterTotal) {
        children.push(new TextRun(resolveTemplate(afterTotal, vars)));
      }
    } else if (afterCurrent) {
      children.push(new TextRun(resolveTemplate(afterCurrent, vars)));
    }
  }

  return children;
}

function buildBand(
  config: ExportHeaderFooterConfig | null,
  vars: Record<string, string>,
): Paragraph | undefined {
  if (!config || (!config.text && !config.pageNumber.enabled)) {
    return undefined;
  }
  const paragraphAlignment = alignment(config.alignment);
  return new Paragraph({
    ...(paragraphAlignment ? { alignment: paragraphAlignment } : {}),
    children: bandChildren(config, vars),
  });
}

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
  const lineHeight = block.lineHeight ? Number(block.lineHeight) : Number.NaN;

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
  return blocks.flatMap((block) => blockToParagraphs(block));
}

function blockToParagraphs(block: ExportBlock): Paragraph[] {
  if (
    block.kind === 'paragraph' ||
    block.kind === 'heading' ||
    block.kind === 'blockquote' ||
    block.kind === 'codeBlock'
  ) {
    return [textBlockParagraph(block)];
  }
  if (block.kind === 'image') {
    return [imageParagraph(block)];
  }
  if (block.kind === 'sceneDivider') {
    return [sceneDividerParagraph(block.variant)];
  }
  if (block.kind === 'horizontalRule') {
    return [new Paragraph({ thematicBreak: true })];
  }
  return listParagraphs(block);
}

function sceneDividerParagraph(
  variant: Parameters<typeof sceneDividerSvg>[0],
): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: 'svg',
        data: Buffer.from(sceneDividerSvg(variant)),
        transformation: { width: 256, height: 64 },
        fallback: {
          type: 'png',
          data: sceneDividerPngFallback(variant),
        },
      }),
    ],
  });
}

function bookmarkedParagraph(
  text: string,
  anchor: string,
  headingLevel: (typeof HeadingLevel)[keyof typeof HeadingLevel],
): Paragraph {
  return new Paragraph({
    heading: headingLevel,
    children: [
      new Bookmark({
        id: anchor,
        children: [new TextRun({ text })],
      }),
    ],
  });
}

function tocParagraph(title: string, anchor: string, level: number): Paragraph {
  return new Paragraph({
    indent: { left: level * 360 },
    spacing: { after: 100 },
    children: [
      new InternalHyperlink({
        anchor,
        children: [
          new TextRun({
            text: title,
            color: '5B3D6F',
            underline: { type: 'single' },
          }),
        ],
      }),
    ],
  });
}

function imageParagraph(
  block: Extract<ExportBlock, { kind: 'image' }>,
): Paragraph {
  return new Paragraph({
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
  });
}

function listParagraphs(
  block: Extract<ExportBlock, { kind: 'bulletList' | 'orderedList' }>,
): Paragraph[] {
  const bullet = block.kind === 'bulletList';
  return block.items.flatMap((item) => {
    const firstParagraph = item.find(
      (
        child,
      ): child is Extract<ExportBlock, { kind: 'paragraph' | 'heading' }> =>
        child.kind === 'paragraph' || child.kind === 'heading',
    );

    if (!firstParagraph) {
      return [
        new Paragraph({ text: bullet ? '•' : '1.' }),
        ...blocksToParagraphs(item),
      ];
    }

    return [
      new Paragraph(paragraphOptions(firstParagraph, undefined, bullet)),
      ...blocksToParagraphs(item.filter((child) => child !== firstParagraph)),
    ];
  });
}

@Injectable()
export class DocxExportRenderer implements ExportRenderer {
  readonly format = 'DOCX' as const;

  async render(
    document: ExportDocument,
    settings: ExportSettingsConfig,
  ): Promise<RenderedExport> {
    const children: Paragraph[] = [];
    const toc = buildExportToc(document);

    children.push(
      new Paragraph({
        text: 'Índice',
        heading: HeadingLevel.HEADING_1,
      }),
      ...toc.map((entry) =>
        tocParagraph(entry.title, entry.anchor, entry.level),
      ),
      new Paragraph({ children: [new PageBreak()] }),
    );

    document.chapters.forEach((chapter, chapterIndex) => {
      if (chapterIndex > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(
        bookmarkedParagraph(
          chapter.title,
          exportAnchor('chapter', chapter.id),
          HeadingLevel.HEADING_2,
        ),
      );
      chapter.scenes.forEach((scene, sceneIndex) => {
        if (scene.title) {
          children.push(
            bookmarkedParagraph(
              scene.title,
              exportAnchor('scene', scene.id),
              HeadingLevel.HEADING_3,
            ),
          );
        }
        children.push(...blocksToParagraphs(scene.content));
        if (sceneIndex < chapter.scenes.length - 1) {
          children.push(new Paragraph({ children: [new PageBreak()] }));
        }
      });
    });

    const vars = {
      tituloLibro: document.title,
      fecha: new Date().toLocaleDateString('es'),
    };
    const headerParagraph = buildBand(settings.header, vars);
    const footerParagraph = buildBand(settings.footer, vars);
    const margin = {
      top: Math.round(settings.margins.topCm * CM_TO_TWIPS),
      bottom: Math.round(settings.margins.bottomCm * CM_TO_TWIPS),
      left: Math.round(settings.margins.leftCm * CM_TO_TWIPS),
      right: Math.round(settings.margins.rightCm * CM_TO_TWIPS),
      header: HEADER_FOOTER_DISTANCE_TWIPS,
      footer: HEADER_FOOTER_DISTANCE_TWIPS,
    };

    const file = new Document({
      sections: [
        {
          // Portada: sin headers/footers y sin entrar en la numeración de
          // página de la sección de contenido (section break = página nueva).
          properties: { page: { margin } },
          children: [
            new Paragraph({
              heading: HeadingLevel.TITLE,
              children: [
                new Bookmark({
                  id: exportAnchor('book', document.id),
                  children: [new TextRun({ text: document.title })],
                }),
              ],
            }),
          ],
        },
        {
          properties: {
            page: { margin, pageNumbers: { start: 1 } },
          },
          ...(headerParagraph
            ? {
                headers: {
                  default: new Header({ children: [headerParagraph] }),
                },
              }
            : {}),
          ...(footerParagraph
            ? {
                footers: {
                  default: new Footer({ children: [footerParagraph] }),
                },
              }
            : {}),
          children,
        },
      ],
    });
    return {
      buffer: await Packer.toBuffer(file),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'DOCX',
    };
  }
}
