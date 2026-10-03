import { Injectable } from '@nestjs/common';
import {
  AlignmentType,
  Document,
  EndnoteReferenceRun,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  ImageRun,
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
import { bookNotes } from '../export.types';
import { restartFootnotesEachPage } from './docx-footnote-restart';
import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  ExportInline,
  ExportNote,
  ExportTextBlock,
  RenderedExport,
} from '../export.types';

/**
 * Assigns `docx`'s own numeric footnote/endnote dictionary keys (independent
 * of our central whole-book display `number`) and collects the rendered
 * paragraphs for each note the first time it's referenced in document order.
 */
interface DocxNoteContext {
  notesById: Map<string, ExportNote>;
  footnoteIds: Map<string, number>;
  endnoteIds: Map<string, number>;
  footnotes: Record<string, { children: Paragraph[] }>;
  endnotes: Record<string, { children: Paragraph[] }>;
  nextFootnoteId: { value: number };
  nextEndnoteId: { value: number };
}

function createDocxNoteContext(document: ExportDocument): DocxNoteContext {
  const notesById = new Map<string, ExportNote>();
  for (const note of bookNotes(document)) {
    notesById.set(note.id, note);
  }
  return {
    notesById,
    footnoteIds: new Map(),
    endnoteIds: new Map(),
    footnotes: {},
    endnotes: {},
    nextFootnoteId: { value: 1 },
    nextEndnoteId: { value: 1 },
  };
}

function resolveNoteReferenceRun(
  inline: Extract<ExportInline, { kind: 'noteReference' }>,
  notes: DocxNoteContext,
): ParagraphChild {
  const note = notes.notesById.get(inline.noteId);
  const body = note ? blocksToParagraphs(note.content, notes) : [];

  if (inline.noteType === 'ENDNOTE') {
    let id = notes.endnoteIds.get(inline.noteId);
    if (id === undefined) {
      id = notes.nextEndnoteId.value++;
      notes.endnoteIds.set(inline.noteId, id);
      notes.endnotes[String(id)] = { children: body };
    }
    // `docx`'s ParagraphChild union omits EndnoteReferenceRun even though it
    // extends the same `Run` base as FootnoteReferenceRun (library typing
    // gap) — the resulting OOXML (`w:endnoteReference`) is valid regardless.
    return new EndnoteReferenceRun(id);
  }

  let id = notes.footnoteIds.get(inline.noteId);
  if (id === undefined) {
    id = notes.nextFootnoteId.value++;
    notes.footnoteIds.set(inline.noteId, id);
    notes.footnotes[String(id)] = { children: body };
  }
  return new FootnoteReferenceRun(id);
}

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

function inlineRuns(
  inlines: ExportInline[],
  notes: DocxNoteContext,
): ParagraphChild[] {
  const children: ParagraphChild[] = [];

  for (const inline of inlines) {
    if (inline.kind === 'break') {
      children.push(new TextRun({ break: 1 }));
      continue;
    }

    if (inline.kind === 'noteReference') {
      children.push(resolveNoteReferenceRun(inline, notes));
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
  notes: DocxNoteContext,
  children: ParagraphChild[] = inlineRuns(block.inlines, notes),
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

function textBlockParagraph(
  block: ExportTextBlock,
  notes: DocxNoteContext,
): Paragraph {
  if (block.kind === 'codeBlock') {
    const children = block.inlines.map((inline) => {
      if (inline.kind === 'break') {
        return new TextRun({ break: 1 });
      }
      if (inline.kind === 'noteReference') {
        return resolveNoteReferenceRun(inline, notes);
      }
      return new TextRun({ text: inline.text, font: 'Courier New' });
    });
    return new Paragraph(paragraphOptions(block, notes, children));
  }

  if (block.kind === 'blockquote') {
    const children = block.inlines.map((inline) => {
      if (inline.kind === 'break') {
        return new TextRun({ break: 1 });
      }
      if (inline.kind === 'noteReference') {
        return resolveNoteReferenceRun(inline, notes);
      }
      return new TextRun({
        text: inline.text,
        bold: inline.bold,
        italics: true,
      });
    });
    return new Paragraph({
      ...paragraphOptions(block, notes, children),
      indent: { left: 720 },
    });
  }

  return new Paragraph(paragraphOptions(block, notes));
}

function blocksToParagraphs(
  blocks: ExportBlock[],
  notes: DocxNoteContext,
): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  for (const block of blocks) {
    if (
      block.kind === 'paragraph' ||
      block.kind === 'heading' ||
      block.kind === 'blockquote' ||
      block.kind === 'codeBlock'
    ) {
      paragraphs.push(textBlockParagraph(block, notes));
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
      // Línea horizontal nativa de Word (borde inferior de un párrafo
      // vacío) — el mismo mecanismo que usa Word al escribir "---" y
      // presionar Enter. Consistente con el <hr/> de EPUB.
      paragraphs.push(new Paragraph({ thematicBreak: true }));
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
          new Paragraph(
            paragraphOptions(firstParagraph, notes, undefined, bullet),
          ),
        );
        paragraphs.push(
          ...blocksToParagraphs(
            item.filter((child) => child !== firstParagraph),
            notes,
          ),
        );
      } else {
        paragraphs.push(new Paragraph({ text: bullet ? '•' : '1.' }));
        paragraphs.push(...blocksToParagraphs(item, notes));
      }
    }
  }

  return paragraphs;
}

@Injectable()
export class DocxExportRenderer implements ExportRenderer {
  readonly format = 'DOCX' as const;

  async render(
    document: ExportDocument,
    settings: ExportSettingsConfig,
  ): Promise<RenderedExport> {
    const children: Paragraph[] = [];
    const notes = createDocxNoteContext(document);

    document.chapters.forEach((chapter, chapterIndex) => {
      if (chapterIndex > 0) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      children.push(
        new Paragraph({
          text: chapter.title,
          heading: HeadingLevel.HEADING_2,
        }),
      );
      chapter.scenes.forEach((scene, sceneIndex) => {
        if (scene.title) {
          children.push(
            new Paragraph({
              text: scene.title,
              heading: HeadingLevel.HEADING_3,
            }),
          );
        }
        children.push(...blocksToParagraphs(scene.content, notes));
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
      ...(Object.keys(notes.footnotes).length > 0
        ? { footnotes: notes.footnotes }
        : {}),
      ...(Object.keys(notes.endnotes).length > 0
        ? { endnotes: notes.endnotes }
        : {}),
      sections: [
        {
          // Portada: sin headers/footers y sin entrar en la numeración de
          // página de la sección de contenido (section break = página nueva).
          properties: { page: { margin } },
          children: [
            new Paragraph({
              text: document.title,
              heading: HeadingLevel.TITLE,
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
    const rawBuffer = await Packer.toBuffer(file);
    return {
      buffer: await restartFootnotesEachPage(rawBuffer),
      contentType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'DOCX',
    };
  }
}
