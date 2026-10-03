import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  ExportInline,
  ExportNote,
  NoteType,
} from './export.types';
import type { ExportSourceRecord } from './export-source.port';

type JsonRecord = Record<string, unknown>;
type ImageResolver = (
  storageKey: string,
  sceneId?: string,
) => Promise<ExportImage>;
/** Mutable whole-book counter: footnotes and endnotes share one sequence, never reset. */
interface NoteCounter {
  value: number;
}
const NOTE_TYPES = new Set<NoteType>(['FOOTNOTE', 'ENDNOTE']);

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function childNodes(node: JsonRecord): unknown[] {
  return Array.isArray(node['content']) ? node['content'] : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function nodeAttributes(node: JsonRecord): JsonRecord {
  return isRecord(node['attrs']) ? node['attrs'] : {};
}

function textMarks(node: JsonRecord): ExportInline {
  const marks = Array.isArray(node['marks']) ? node['marks'] : [];
  let bold = false;
  let italic = false;
  let href: string | undefined;

  for (const mark of marks) {
    if (!isRecord(mark)) {
      continue;
    }
    const type = mark['type'];
    if (type === 'bold' || type === 'strong') {
      bold = true;
    }
    if (type === 'italic' || type === 'em') {
      italic = true;
    }
    if (type === 'link' && isRecord(mark['attrs'])) {
      href = stringValue(mark['attrs']['href']);
    }
  }

  const inline: ExportInline = {
    kind: 'text',
    text: typeof node['text'] === 'string' ? node['text'] : '',
    bold,
    italic,
  };
  if (href) {
    inline.href = href;
  }
  return inline;
}

/** Collects footnote/endnote bodies for the current scene, numbered sequentially across the whole book. */
interface NoteCollector {
  counter: NoteCounter;
  notes: ExportNote[];
}

function footnoteNodeAttrs(
  node: JsonRecord,
): { id: string; noteType: NoteType } | undefined {
  const attrs = nodeAttributes(node);
  const id = stringValue(attrs['id']);
  const noteType = attrs['noteType'];
  if (
    !id ||
    typeof noteType !== 'string' ||
    !NOTE_TYPES.has(noteType as NoteType)
  ) {
    return undefined;
  }
  return { id, noteType: noteType as NoteType };
}

async function parseInlines(
  nodes: unknown[],
  resolveImage: ImageResolver,
  sceneId?: string,
  collector?: NoteCollector,
): Promise<ExportInline[]> {
  const inlines: ExportInline[] = [];

  for (const value of nodes) {
    if (!isRecord(value)) {
      continue;
    }

    if (value['type'] === 'text') {
      inlines.push(textMarks(value));
      continue;
    }

    if (value['type'] === 'hardBreak') {
      inlines.push({ kind: 'break' });
      continue;
    }

    if (value['type'] === 'footnoteReference') {
      const parsed = footnoteNodeAttrs(value);
      if (!parsed || !collector) {
        continue;
      }
      const number = ++collector.counter.value;
      const content = await parseBlocks(
        childNodes(value),
        resolveImage,
        sceneId,
      );
      collector.notes.push({
        id: parsed.id,
        noteType: parsed.noteType,
        content,
        number,
      });
      inlines.push({
        kind: 'noteReference',
        noteId: parsed.id,
        noteType: parsed.noteType,
        number,
      });
      continue;
    }

    if (value['type'] === 'paragraph' || value['type'] === 'inline') {
      inlines.push(
        ...(await parseInlines(
          childNodes(value),
          resolveImage,
          sceneId,
          collector,
        )),
      );
    }
  }

  return inlines;
}

function imageStorageKey(node: JsonRecord): string | undefined {
  const attrs = nodeAttributes(node);
  const storageKey = stringValue(attrs['storageKey']);
  if (storageKey) {
    return storageKey;
  }

  const src = stringValue(attrs['src']);
  if (src && !/^https?:\/\//i.test(src) && !src.startsWith('data:')) {
    return src;
  }

  return undefined;
}

async function parseBlocks(
  nodes: unknown[],
  resolveImage: ImageResolver,
  sceneId?: string,
  collector?: NoteCollector,
): Promise<ExportBlock[]> {
  const blocks: ExportBlock[] = [];

  for (const value of nodes) {
    if (!isRecord(value)) {
      continue;
    }

    const type = value['type'];
    if (type === 'doc') {
      blocks.push(
        ...(await parseBlocks(
          childNodes(value),
          resolveImage,
          sceneId,
          collector,
        )),
      );
      continue;
    }

    if (type === 'paragraph' || type === 'heading') {
      const attrs = nodeAttributes(value);
      const block: ExportBlock = {
        kind: type,
        inlines: await parseInlines(
          childNodes(value),
          resolveImage,
          sceneId,
          collector,
        ),
        ...(type === 'heading'
          ? { level: typeof attrs['level'] === 'number' ? attrs['level'] : 1 }
          : {}),
        ...(typeof attrs['textAlign'] === 'string'
          ? { textAlign: attrs['textAlign'] }
          : {}),
        ...(typeof attrs['lineHeight'] === 'string'
          ? { lineHeight: attrs['lineHeight'] }
          : {}),
        ...(typeof attrs['indentLeft'] === 'number'
          ? { indentLeft: attrs['indentLeft'] }
          : {}),
        ...(typeof attrs['indentRight'] === 'number'
          ? { indentRight: attrs['indentRight'] }
          : {}),
        ...(typeof attrs['firstLineIndent'] === 'number'
          ? { firstLineIndent: attrs['firstLineIndent'] }
          : {}),
      };
      blocks.push(block);
      continue;
    }

    if (type === 'blockquote' || type === 'codeBlock') {
      const inlines = await parseInlines(
        childNodes(value),
        resolveImage,
        sceneId,
        collector,
      );
      blocks.push({ kind: type, inlines });
      continue;
    }

    if (type === 'bulletList' || type === 'orderedList') {
      const items: ExportBlock[][] = [];
      for (const item of childNodes(value)) {
        if (!isRecord(item)) {
          continue;
        }
        items.push(
          await parseBlocks(childNodes(item), resolveImage, sceneId, collector),
        );
      }
      blocks.push({ kind: type, items });
      continue;
    }

    if (type === 'horizontalRule' || type === 'sceneDivider') {
      blocks.push({ kind: 'sceneDivider' });
      continue;
    }

    if (type === 'image') {
      const key = imageStorageKey(value);
      if (!key) {
        continue;
      }
      const image = await resolveImage(key, sceneId);
      const attrs = nodeAttributes(value);
      blocks.push({
        kind: 'image',
        image,
        alt: stringValue(attrs['alt']) ?? 'Imagen de la obra',
      });
      continue;
    }

    const nestedBlocks = await parseBlocks(
      childNodes(value),
      resolveImage,
      sceneId,
      collector,
    );
    if (nestedBlocks.length > 0) {
      blocks.push(...nestedBlocks);
    } else if (typeof value['text'] === 'string') {
      blocks.push({
        kind: 'paragraph',
        inlines: [textMarks(value)],
      });
    }
  }

  return blocks;
}

export async function prepareExportDocument(
  source: ExportSourceRecord,
  resolveImage: ImageResolver,
): Promise<ExportDocument> {
  const chapters = [];
  // Footnotes and endnotes share one sequence for the whole book; it is
  // never reset. PDF's FOOTNOTE markers ignore this and compute their own
  // page-scoped number at layout time instead (see pdf-export.renderer.ts).
  const counter: NoteCounter = { value: 0 };

  for (const chapter of source.chapters) {
    const scenes = [];
    for (const scene of chapter.scenes) {
      const notes: ExportNote[] = [];
      const content = await parseBlocks(
        scene.content && isRecord(scene.content) ? [scene.content] : [],
        resolveImage,
        scene.id,
        { counter, notes },
      );
      scenes.push({ title: scene.title, content, notes });
    }
    chapters.push({ title: chapter.title, scenes });
  }

  return { title: source.title, chapters };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function inlineHtml(inline: ExportInline): string {
  if (inline.kind === 'break') {
    return '<br />';
  }

  if (inline.kind === 'noteReference') {
    return `<a id="ref-${escapeHtml(inline.noteId)}" href="#note-${escapeHtml(
      inline.noteId,
    )}" epub:type="noteref" class="footnote-ref"><sup>${inline.number}</sup></a>`;
  }

  let result = escapeHtml(inline.text);
  if (inline.bold) {
    result = `<strong>${result}</strong>`;
  }
  if (inline.italic) {
    result = `<em>${result}</em>`;
  }
  if (inline.href) {
    result = `<a href="${escapeHtml(inline.href)}">${result}</a>`;
  }
  return result;
}

function blocksHtml(
  blocks: ExportBlock[],
  imageSrc: (image: ExportImage) => string,
): string {
  return blocks
    .map((block) => {
      if (
        block.kind === 'paragraph' ||
        block.kind === 'heading' ||
        block.kind === 'blockquote' ||
        block.kind === 'codeBlock'
      ) {
        const content = block.inlines.map(inlineHtml).join('');
        const style = [
          block.textAlign ? `text-align:${block.textAlign}` : '',
          block.lineHeight ? `line-height:${block.lineHeight}` : '',
          block.indentLeft ? `margin-left:${block.indentLeft}cm` : '',
          block.indentRight ? `margin-right:${block.indentRight}cm` : '',
          block.firstLineIndent ? `text-indent:${block.firstLineIndent}cm` : '',
        ]
          .filter(Boolean)
          .join(';');
        const styleAttribute = style ? ` style="${style}"` : '';

        if (block.kind === 'heading') {
          const level = Math.min(6, Math.max(1, block.level ?? 1));
          return `<h${level}${styleAttribute}>${content}</h${level}>`;
        }
        if (block.kind === 'blockquote') {
          return `<blockquote${styleAttribute}>${content}</blockquote>`;
        }
        if (block.kind === 'codeBlock') {
          return `<pre${styleAttribute}><code>${content}</code></pre>`;
        }
        return `<p${styleAttribute}>${content}</p>`;
      }

      if (block.kind === 'bulletList' || block.kind === 'orderedList') {
        const tag = block.kind === 'bulletList' ? 'ul' : 'ol';
        return `<${tag}>${block.items
          .map((item) => `<li>${blocksHtml(item, imageSrc)}</li>`)
          .join('')}</${tag}>`;
      }

      if (block.kind === 'sceneDivider') {
        return '<hr />';
      }

      return `<p class="image"><img src="${escapeHtml(imageSrc(block.image))}" alt="${escapeHtml(block.alt)}" /></p>`;
    })
    .join('\n');
}

export function blocksToHtml(
  blocks: ExportBlock[],
  imageSrc: (image: ExportImage) => string = (image) =>
    `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
): string {
  return blocksHtml(blocks, imageSrc);
}

export function inlineText(inlines: ExportInline[]): string {
  return inlines
    .map((inline) => {
      if (inline.kind === 'break') {
        return '\n';
      }
      if (inline.kind === 'noteReference') {
        return `[${inline.number}]`;
      }
      return inline.text;
    })
    .join('');
}
