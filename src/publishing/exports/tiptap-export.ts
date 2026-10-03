import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  ExportInline,
} from './export.types';
import type { ExportSourceRecord } from './export-source.port';

type JsonRecord = Record<string, unknown>;
type ImageResolver = (
  storageKey: string,
  sceneId?: string,
) => Promise<ExportImage>;

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

async function parseInlines(
  nodes: unknown[],
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<ExportInline[]> {
  const parsed = await Promise.all(
    nodes.map((value) => parseInline(value, resolveImage, sceneId)),
  );
  return parsed.flat();
}

async function parseInline(
  value: unknown,
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<ExportInline[]> {
  if (!isRecord(value)) {
    return [];
  }
  if (value['type'] === 'text') {
    return [textMarks(value)];
  }
  if (value['type'] === 'hardBreak') {
    return [{ kind: 'break' }];
  }
  if (value['type'] === 'paragraph' || value['type'] === 'inline') {
    return parseInlines(childNodes(value), resolveImage, sceneId);
  }
  return [];
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
): Promise<ExportBlock[]> {
  const parsed = await Promise.all(
    nodes.map((value) => parseBlock(value, resolveImage, sceneId)),
  );
  return parsed.flat();
}

async function parseBlock(
  value: unknown,
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<ExportBlock[]> {
  if (!isRecord(value)) {
    return [];
  }

  const type = value['type'];
  if (type === 'doc') {
    return parseBlocks(childNodes(value), resolveImage, sceneId);
  }
  if (type === 'paragraph' || type === 'heading') {
    return [await parseTextBlock(value, type, resolveImage, sceneId)];
  }
  if (type === 'blockquote' || type === 'codeBlock') {
    const inlines = await parseInlines(
      childNodes(value),
      resolveImage,
      sceneId,
    );
    return [{ kind: type, inlines }];
  }
  if (type === 'bulletList' || type === 'orderedList') {
    return [await parseListBlock(value, type, resolveImage, sceneId)];
  }
  if (type === 'horizontalRule' || type === 'sceneDivider') {
    return [{ kind: 'sceneDivider' }];
  }
  if (type === 'image') {
    const image = await parseImageBlock(value, resolveImage, sceneId);
    return image ? [image] : [];
  }

  const nestedBlocks = await parseBlocks(
    childNodes(value),
    resolveImage,
    sceneId,
  );
  if (nestedBlocks.length > 0) {
    return nestedBlocks;
  }
  return typeof value['text'] === 'string'
    ? [{ kind: 'paragraph', inlines: [textMarks(value)] }]
    : [];
}

async function parseTextBlock(
  value: JsonRecord,
  type: 'paragraph' | 'heading',
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<ExportBlock> {
  const attrs = nodeAttributes(value);
  return {
    kind: type,
    inlines: await parseInlines(childNodes(value), resolveImage, sceneId),
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
}

async function parseListBlock(
  value: JsonRecord,
  type: 'bulletList' | 'orderedList',
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<ExportBlock> {
  const items = await Promise.all(
    childNodes(value).map((item) =>
      isRecord(item)
        ? parseBlocks(childNodes(item), resolveImage, sceneId)
        : Promise.resolve([]),
    ),
  );
  return { kind: type, items };
}

async function parseImageBlock(
  value: JsonRecord,
  resolveImage: ImageResolver,
  sceneId?: string,
): Promise<Extract<ExportBlock, { kind: 'image' }> | null> {
  const key = imageStorageKey(value);
  if (!key) {
    return null;
  }

  const image = await resolveImage(key, sceneId);
  const attrs = nodeAttributes(value);
  return {
    kind: 'image',
    image,
    alt: stringValue(attrs['alt']) ?? 'Imagen de la obra',
  };
}

export async function prepareExportDocument(
  source: ExportSourceRecord,
  resolveImage: ImageResolver,
): Promise<ExportDocument> {
  const chapters = await Promise.all(
    source.chapters.map(async (chapter) => ({
      title: chapter.title,
      scenes: await Promise.all(
        chapter.scenes.map(async (scene) => ({
          title: scene.title,
          content: await parseBlocks(
            scene.content && isRecord(scene.content) ? [scene.content] : [],
            resolveImage,
            scene.id,
          ),
        })),
      ),
    })),
  );

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
  return blocks.map((block) => blockHtml(block, imageSrc)).join('\n');
}

function blockHtml(
  block: ExportBlock,
  imageSrc: (image: ExportImage) => string,
): string {
  if (
    block.kind === 'paragraph' ||
    block.kind === 'heading' ||
    block.kind === 'blockquote' ||
    block.kind === 'codeBlock'
  ) {
    return textBlockHtml(block);
  }
  if (block.kind === 'bulletList' || block.kind === 'orderedList') {
    const tag = block.kind === 'bulletList' ? 'ul' : 'ol';
    const items = block.items
      .map((item) => `<li>${blocksHtml(item, imageSrc)}</li>`)
      .join('');
    return `<${tag}>${items}</${tag}>`;
  }
  if (block.kind === 'sceneDivider') {
    return '<hr />';
  }
  return `<p class="image"><img src="${escapeHtml(imageSrc(block.image))}" alt="${escapeHtml(block.alt)}" /></p>`;
}

function textBlockHtml(
  block: Extract<ExportBlock, { inlines: ExportInline[] }>,
): string {
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

export function blocksToHtml(
  blocks: ExportBlock[],
  imageSrc: (image: ExportImage) => string = (image) =>
    `data:${image.mimeType};base64,${image.buffer.toString('base64')}`,
): string {
  return blocksHtml(blocks, imageSrc);
}

export function inlineText(inlines: ExportInline[]): string {
  return inlines
    .map((inline) => (inline.kind === 'break' ? '\n' : inline.text))
    .join('');
}
