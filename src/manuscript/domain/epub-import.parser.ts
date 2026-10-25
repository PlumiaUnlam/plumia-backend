import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

type JSZipObject = JSZip.JSZipObject;

export class EpubImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpubImportError';
  }
}

class ArchiveEntryTooLargeError extends Error {}
class EpubArchiveLimitError extends EpubImportError {}

interface DecompressionBudget {
  decompressedBytes: number;
}

const MAX_ARCHIVE_ENTRIES = 5_000;
const MAX_UNCOMPRESSED_ARCHIVE_SIZE = 250 * 1024 * 1024;
const MAX_XML_ENTRY_SIZE = 30 * 1024 * 1024;
export const MAX_EPUB_FILE_SIZE = 50 * 1024 * 1024;
const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
const MAX_IMAGES = 200;
const XHTML_MEDIA_TYPES = new Set([
  'application/xhtml+xml',
  'text/html',
  'application/x-dtbook+xml',
]);
const IMAGE_TYPES: Record<string, { contentType: string; extension: string }> =
  {
    '.jpg': { contentType: 'image/jpeg', extension: 'jpg' },
    '.jpeg': { contentType: 'image/jpeg', extension: 'jpg' },
    '.png': { contentType: 'image/png', extension: 'png' },
    '.webp': { contentType: 'image/webp', extension: 'webp' },
    '.avif': { contentType: 'image/avif', extension: 'avif' },
  };
const XML_PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
});

interface XmlText {
  kind: 'text';
  value: string;
}

interface XmlElement {
  kind: 'element';
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
}
type XmlNode = XmlText | XmlElement;

export interface EpubImportImage {
  id: string;
  buffer: Buffer;
  contentType: string;
  extension: string;
}

export interface EpubImportScene {
  title: string;
  content: Record<string, unknown>;
}

export interface EpubImportChapter {
  title: string;
  scenes: EpubImportScene[];
}

export interface ParsedEpub {
  title: string;
  chapters: EpubImportChapter[];
  images: Map<string, EpubImportImage>;
  skippedImages: number;
}

interface ImageCatalog {
  bySource: Map<string, string | null>;
  images: Map<string, EpubImportImage>;
  skippedSources: Set<string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOrderedRecord(value: unknown): XmlNode[] {
  const record = asRecord(value);
  if (!record) {
    return [];
  }
  if ('#text' in record) {
    const text = record['#text'];
    return typeof text === 'string' && text
      ? [{ kind: 'text', value: text }]
      : [];
  }

  const rawAttributes = asRecord(record[':@']) ?? {};
  const attributes = Object.fromEntries(
    Object.entries(rawAttributes)
      .filter(
        ([key, attributeValue]) =>
          key.startsWith('@_') && typeof attributeValue === 'string',
      )
      .map(([key, attributeValue]) => [
        key.slice(2).toLowerCase(),
        attributeValue as string,
      ]),
  );
  return Object.entries(record).flatMap(([name, children]) => {
    if (
      name === ':@' ||
      name.startsWith('#') ||
      name.startsWith('?') ||
      name.startsWith('!')
    ) {
      return [];
    }
    return [
      {
        kind: 'element' as const,
        name: name.toLowerCase(),
        attributes,
        children: parseOrderedNodes(children),
      },
    ];
  });
}

function parseOrderedNodes(value: unknown): XmlNode[] {
  return Array.isArray(value) ? value.flatMap(parseOrderedRecord) : [];
}

function parseXml(xml: string): XmlElement {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new EpubImportError('El EPUB contiene un documento XML inválido.');
  }

  const root = parseOrderedNodes(XML_PARSER.parse(xml)).find(
    (node): node is XmlElement => node.kind === 'element',
  );
  if (!root) {
    throw new EpubImportError('El EPUB no contiene documentos válidos.');
  }
  return root;
}

function elements(node: XmlNode, name: string): XmlElement[] {
  if (node.kind !== 'element') {
    return [];
  }

  const matches = node.name === name ? [node] : [];
  return matches.concat(...node.children.map((child) => elements(child, name)));
}

function textContent(node: XmlNode): string {
  if (node.kind === 'text') {
    return node.value;
  }
  return node.children.map(textContent).join('');
}

function attribute(node: XmlElement, name: string): string | undefined {
  return node.attributes[name.toLowerCase()];
}

function archivePath(baseFile: string, reference: string): string {
  const pathPart = reference.split(/[?#]/, 1)[0] ?? '';
  if (!pathPart) {
    return baseFile;
  }

  let url: URL;
  try {
    url = new URL(
      pathPart.replaceAll('\\', '/'),
      `https://epub.invalid/${baseFile}`,
    );
  } catch {
    throw new EpubImportError('El EPUB contiene una ruta de archivo inválida.');
  }

  if (url.origin !== 'https://epub.invalid') {
    throw new EpubImportError('El EPUB contiene una ruta externa inválida.');
  }

  try {
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new EpubImportError('El EPUB contiene una ruta de archivo inválida.');
  }
}

interface JSZipNodeStream extends NodeJS.ReadableStream {
  destroy(error?: Error): this;
  _helper?: {
    pause(): unknown;
  };
}

function abortArchiveStream(stream: JSZipNodeStream): void {
  stream._helper?.pause();
  stream.destroy();
}

function readArchiveBytes(
  file: JSZipObject,
  maxEntryBytes: number,
  budget: DecompressionBudget,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const stream = file.nodeStream('nodebuffer') as JSZipNodeStream;
    const chunks: Buffer[] = [];
    let entryBytes = 0;
    let settled = false;

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
      abortArchiveStream(stream);
    };

    stream.on('data', (chunk: Buffer) => {
      if (settled) {
        return;
      }
      entryBytes += chunk.length;
      budget.decompressedBytes += chunk.length;
      if (budget.decompressedBytes > MAX_UNCOMPRESSED_ARCHIVE_SIZE) {
        fail(
          new EpubArchiveLimitError(
            'El EPUB excede el tamaño descomprimido permitido.',
          ),
        );
        return;
      }
      if (entryBytes > maxEntryBytes) {
        fail(new ArchiveEntryTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', () => {
      fail(new EpubImportError('El EPUB está incompleto o dañado.'));
    });
    stream.on('end', () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks, entryBytes));
      }
    });
  });
}

async function readArchiveText(
  zip: JSZip,
  path: string,
  budget: DecompressionBudget,
  maxEntryBytes = MAX_XML_ENTRY_SIZE,
): Promise<string> {
  const file = zip.file(path);
  if (!file || file.dir) {
    throw new EpubImportError('El EPUB está incompleto o dañado.');
  }
  try {
    return (await readArchiveBytes(file, maxEntryBytes, budget)).toString();
  } catch (error) {
    if (error instanceof ArchiveEntryTooLargeError) {
      throw new EpubImportError('El EPUB está incompleto o dañado.');
    }
    throw error;
  }
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ');
}

function trimInlineEdges(nodes: Record<string, unknown>[]): void {
  const textNodes = nodes.filter(
    (node) => node['type'] === 'text' && typeof node['text'] === 'string',
  );
  const first = textNodes[0];
  const last = textNodes.at(-1);
  if (first && typeof first['text'] === 'string') {
    first['text'] = first['text'].trimStart();
  }
  if (last && typeof last['text'] === 'string') {
    last['text'] = last['text'].trimEnd();
  }
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index]?.['type'] === 'text' && !nodes[index]?.['text']) {
      nodes.splice(index, 1);
    }
  }
}

function safeLink(href: string | undefined): string | null {
  if (!href) {
    return null;
  }
  try {
    const url = new URL(href);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? href : null;
  } catch {
    return null;
  }
}

function marksForElement(
  node: XmlElement,
  inheritedMarks: Record<string, unknown>[],
): Record<string, unknown>[] {
  const markType: Record<string, string> = {
    b: 'bold',
    strong: 'bold',
    i: 'italic',
    em: 'italic',
    s: 'strike',
    strike: 'strike',
    del: 'strike',
    code: 'code',
  };
  const markName = markType[node.name];
  if (markName) {
    return [...inheritedMarks, { type: markName }];
  }
  if (node.name === 'a') {
    const href = safeLink(attribute(node, 'href'));
    return href
      ? [...inheritedMarks, { type: 'link', attrs: { href } }]
      : inheritedMarks;
  }
  return inheritedMarks;
}

function inlineNodes(
  nodes: XmlNode[],
  inheritedMarks: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const node of nodes) {
    if (node.kind === 'text') {
      const text = normalizeWhitespace(node.value);
      if (text) {
        result.push({
          type: 'text',
          text,
          ...(inheritedMarks.length ? { marks: inheritedMarks } : {}),
        });
      }
      continue;
    }

    if (node.name === 'br') {
      result.push({ type: 'hardBreak' });
      continue;
    }
    if (node.name === 'img' || node.name === 'svg') {
      continue;
    }

    const marks = marksForElement(node, inheritedMarks);
    result.push(...inlineNodes(node.children, marks));
  }
  return result;
}

function numberWidth(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const match = /^(\d+(?:\.\d+)?)(?:px)?$/i.exec(value.trim());
  if (!match?.[1]) {
    return null;
  }
  const width = Number(match[1]);
  return Number.isFinite(width) && width > 0 ? Math.round(width) : null;
}

function imageLayout(
  image: XmlElement,
  parent: XmlElement,
): { width: number | null; textFlow: string } {
  const style = attribute(image, 'style') ?? '';
  const parentClass = attribute(parent, 'class') ?? '';
  const width =
    numberWidth(attribute(image, 'width')) ??
    numberWidth(/(?:^|;)\s*width\s*:\s*([^;]+)/i.exec(style)?.[1]);
  if (parentClass.split(/\s+/u).includes('image--float-left')) {
    return { width, textFlow: 'text-right' };
  }
  if (parentClass.split(/\s+/u).includes('image--float-right')) {
    return { width, textFlow: 'text-left' };
  }
  return { width, textFlow: 'break' };
}

function dividerNode(element: XmlElement): Record<string, unknown> {
  const image = elements(element, 'img')[0];
  const source = image ? (attribute(image, 'src') ?? '') : '';
  const match =
    /divider-(flourish|diamonds|stars|waves|dots|asterisks|moon)(?:-[0-9a-f]{6})?\.svg(?:[?#]|$)/i.exec(
      source,
    );
  const style = attribute(element, 'style') ?? '';
  const color = /(?:^|;)\s*color\s*:\s*(#[0-9a-f]{6})/i.exec(style)?.[1];
  return {
    type: 'sceneDivider',
    attrs: {
      variant: match?.[1]?.toLowerCase() ?? 'flourish',
      ...(color ? { color: color.toLowerCase() } : {}),
    },
  };
}

function makeImageNode(
  image: XmlElement,
  parent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const source = attribute(image, 'src');
  if (!source) {
    return [];
  }
  const key = imageSourceKey(documentPath, source);
  const assetId = catalog.bySource.get(key);
  if (!assetId) {
    return [];
  }

  const layout = imageLayout(image, parent);
  return [
    {
      type: 'image',
      attrs: {
        src: '',
        storageKey: null,
        alt: attribute(image, 'alt') ?? '',
        width: layout.width,
        textFlow: layout.textFlow,
        epubAssetId: assetId,
      },
    },
  ];
}

function paragraphContent(
  nodes: XmlNode[],
  imageParent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
  inheritedMarks: Record<string, unknown>[] = [],
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let inline: XmlNode[] = [];
  const flushInline = () => {
    const content = inlineNodes(inline, inheritedMarks);
    trimInlineEdges(content);
    if (content.length) {
      result.push({ type: 'paragraph', content });
    }
    inline = [];
  };

  for (const node of nodes) {
    if (node.kind === 'element' && node.name === 'img') {
      flushInline();
      result.push(...makeImageNode(node, imageParent, documentPath, catalog));
    } else if (node.kind === 'element' && elements(node, 'img').length > 0) {
      flushInline();
      const classes = (attribute(node, 'class') ?? '').split(/\s+/u);
      const parent = classes.some((value) =>
        ['image--float-left', 'image--float-right'].includes(value),
      )
        ? node
        : imageParent;
      result.push(
        ...paragraphContent(
          node.children,
          parent,
          documentPath,
          catalog,
          marksForElement(node, inheritedMarks),
        ),
      );
    } else {
      inline.push(node);
    }
  }

  flushInline();
  return result;
}

function paragraph(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  if (
    (attribute(element, 'class') ?? '').split(/\s+/u).includes('scene-divider')
  ) {
    return [dividerNode(element)];
  }

  return paragraphContent(element.children, element, documentPath, catalog);
}

const IGNORED_BLOCK_TAGS = new Set(['script', 'style', 'head', 'title']);
const BLOCK_TAGS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'ol',
  'hr',
  'pre',
  'div',
  'section',
  'article',
  'main',
  'figure',
  'img',
]);

function listBlock(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const listItems = element.children
    .filter(
      (item): item is XmlElement =>
        item.kind === 'element' && item.name === 'li',
    )
    .map((item) => {
      const content = parseBlocks(item, documentPath, catalog);
      return {
        type: 'listItem',
        content: content.length ? content : [{ type: 'paragraph' }],
      };
    });
  if (!listItems.length) {
    return [];
  }
  return [
    {
      type: element.name === 'ul' ? 'bulletList' : 'orderedList',
      ...(element.name === 'ol' && attribute(element, 'start')
        ? { attrs: { start: Number(attribute(element, 'start')) || 1 } }
        : {}),
      content: listItems,
    },
  ];
}

function blockContent(
  child: XmlElement,
  parent: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  if (child.name === 'p') {
    return paragraph(child, documentPath, catalog);
  }
  if (/^h[1-6]$/u.test(child.name)) {
    const content = inlineNodes(child.children);
    trimInlineEdges(content);
    return content.length
      ? [
          {
            type: 'heading',
            attrs: { level: Number(child.name.slice(1)) },
            content,
          },
        ]
      : [];
  }
  if (child.name === 'hr') {
    return [{ type: 'horizontalRule' }];
  }
  if (child.name === 'img') {
    return makeImageNode(child, parent, documentPath, catalog);
  }
  if (child.name === 'ul' || child.name === 'ol') {
    return listBlock(child, documentPath, catalog);
  }
  if (child.name === 'blockquote') {
    const content = parseBlocks(child, documentPath, catalog);
    return content.length ? [{ type: 'blockquote', content }] : [];
  }
  if (child.name === 'pre') {
    const text = textContent(child);
    return text
      ? [{ type: 'codeBlock', content: [{ type: 'text', text }] }]
      : [];
  }
  return parseBlocks(child, documentPath, catalog);
}

function parseBlocks(
  element: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  let inline: XmlNode[] = [];
  const flushInline = () => {
    const content = inlineNodes(inline);
    trimInlineEdges(content);
    if (content.length) {
      result.push({ type: 'paragraph', content });
    }
    inline = [];
  };

  for (const child of element.children) {
    if (child.kind === 'text') {
      inline.push(child);
      continue;
    }
    if (IGNORED_BLOCK_TAGS.has(child.name)) {
      continue;
    }
    if (!BLOCK_TAGS.has(child.name)) {
      if (elements(child, 'img').length > 0) {
        flushInline();
        result.push(
          ...paragraphContent([child], element, documentPath, catalog),
        );
      } else {
        inline.push(child);
      }
      continue;
    }

    flushInline();
    result.push(...blockContent(child, element, documentPath, catalog));
  }

  flushInline();
  return result;
}

function imageSourceKey(documentPath: string, source: string): string {
  if (source.startsWith('data:')) {
    return source;
  }
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
    return source;
  }
  return archivePath(documentPath, source);
}

function imageTypeFromSource(
  source: string,
): { contentType: string; extension: string } | null {
  const withoutQuery = source.split(/[?#]/, 1)[0] ?? source;
  const extension = /\.[^./]+$/u.exec(withoutQuery)?.[0]?.toLowerCase();
  return extension ? (IMAGE_TYPES[extension] ?? null) : null;
}

function dataImage(source: string): Buffer | null {
  const match = /^data:(image\/(?:jpeg|png|webp|avif));([^,]*),(.*)$/is.exec(
    source,
  );
  if (!match?.[2] || match[3] === undefined) {
    return null;
  }
  const isBase64 = match[2].toLowerCase().includes('base64');
  if (
    (isBase64 && match[3].length > Math.ceil((MAX_IMAGE_SIZE * 4) / 3) + 4) ||
    (!isBase64 && match[3].length > MAX_IMAGE_SIZE * 3)
  ) {
    return null;
  }
  try {
    return isBase64
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]));
  } catch {
    return null;
  }
}

function hasAvifBrand(buffer: Buffer): boolean {
  const brandsEnd = Math.min(buffer.length, 64);
  const majorBrand = buffer.toString('ascii', 8, 12);
  if (majorBrand === 'avif' || majorBrand === 'avis') {
    return true;
  }
  for (let offset = 16; offset + 4 <= brandsEnd; offset += 4) {
    const brand = buffer.toString('ascii', offset, offset + 4);
    if (brand === 'avif' || brand === 'avis') {
      return true;
    }
  }
  return false;
}

function imageTypeFromBytes(
  buffer: Buffer,
): { contentType: string; extension: string } | null {
  const isPng =
    buffer.length >= 8 &&
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (isPng) {
    return IMAGE_TYPES['.png']!;
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return IMAGE_TYPES['.jpg']!;
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return IMAGE_TYPES['.webp']!;
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 4, 8) === 'ftyp' &&
    hasAvifBrand(buffer)
  ) {
    return IMAGE_TYPES['.avif']!;
  }
  return null;
}

async function loadArchiveImageBuffer(
  zip: JSZip,
  source: string,
  key: string,
  budget: DecompressionBudget,
): Promise<Buffer | null> {
  if (
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source) ||
    !imageTypeFromSource(key)
  ) {
    return null;
  }

  const file = zip.file(key);
  if (!file || file.dir) {
    return null;
  }
  try {
    return await readArchiveBytes(file, MAX_IMAGE_SIZE, budget);
  } catch (error) {
    if (error instanceof ArchiveEntryTooLargeError) {
      return null;
    }
    throw error;
  }
}

async function loadImageAsset(
  zip: JSZip,
  source: string,
  key: string,
  budget: DecompressionBudget,
): Promise<EpubImportImage | null> {
  const buffer = source.startsWith('data:')
    ? dataImage(source)
    : await loadArchiveImageBuffer(zip, source, key, budget);
  if (!buffer?.length || buffer.length > MAX_IMAGE_SIZE) {
    return null;
  }

  const imageType = imageTypeFromBytes(buffer);
  return imageType ? { id: '', buffer, ...imageType } : null;
}

function mapSequentially<T, R>(
  values: readonly T[],
  map: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let sequence = Promise.resolve();
  values.forEach((value, index) => {
    sequence = sequence.then(async () => {
      results.push(await map(value, index));
    });
  });
  return sequence.then(() => results);
}

async function catalogImages(
  zip: JSZip,
  documentRoot: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
  budget: DecompressionBudget,
): Promise<void> {
  const sources = imagesOutsideDividers(documentRoot).flatMap((image) => {
    const source = attribute(image, 'src');
    if (!source) {
      return [];
    }
    const key = imageSourceKey(documentPath, source);
    if (catalog.bySource.has(key)) {
      return [];
    }
    catalog.bySource.set(key, null);
    return [{ source, key }];
  });

  await mapSequentially(sources, async ({ source, key }) => {
    if (catalog.images.size >= MAX_IMAGES) {
      catalog.skippedSources.add(key);
      return;
    }
    const asset = await loadImageAsset(zip, source, key, budget);
    if (!asset) {
      catalog.skippedSources.add(key);
      return;
    }
    const id = `epub-image-${catalog.images.size + 1}`;
    catalog.images.set(id, { ...asset, id });
    catalog.bySource.set(key, id);
  });
}

function imagesOutsideDividers(
  node: XmlNode,
  insideDivider = false,
): XmlElement[] {
  if (node.kind === 'text') {
    return [];
  }
  const isDivider =
    insideDivider ||
    (node.name === 'p' &&
      (attribute(node, 'class') ?? '').split(/\s+/u).includes('scene-divider'));
  const current = node.name === 'img' && !isDivider ? [node] : [];
  return current.concat(
    ...node.children.map((child) => imagesOutsideDividers(child, isDivider)),
  );
}

function navigationTitles(
  root: XmlElement,
  navPath: string,
): Map<string, string> {
  const titles = new Map<string, string>();
  for (const link of elements(root, 'a')) {
    const href = attribute(link, 'href');
    const label = textContent(link).trim();
    if (href && label) {
      titles.set(archivePath(navPath, href), label);
    }
  }
  return titles;
}

function ncxTitles(root: XmlElement, navPath: string): Map<string, string> {
  const titles = new Map<string, string>();
  for (const point of elements(root, 'navpoint')) {
    const content = elements(point, 'content')[0];
    const navLabel = elements(point, 'text')[0];
    const contentSrc = content ? attribute(content, 'src') : undefined;
    const label = navLabel ? textContent(navLabel).trim() : '';
    if (contentSrc && label) {
      titles.set(archivePath(navPath, contentSrc), label);
    }
  }
  return titles;
}

async function tocTitles(
  zip: JSZip,
  opfPath: string,
  manifest: XmlElement[],
  budget: DecompressionBudget,
): Promise<Map<string, string>> {
  const navItem = manifest.find((item) =>
    (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav'),
  );
  const ncxItem = manifest.find(
    (item) => attribute(item, 'media-type') === 'application/x-dtbncx+xml',
  );
  const item = navItem ?? ncxItem;
  const href = item ? attribute(item, 'href') : undefined;
  if (!item || !href) {
    return new Map<string, string>();
  }

  const navPath = archivePath(opfPath, href);
  try {
    const root = parseXml(await readArchiveText(zip, navPath, budget));
    return item === navItem
      ? navigationTitles(root, navPath)
      : ncxTitles(root, navPath);
  } catch (error) {
    if (error instanceof EpubArchiveLimitError) {
      throw error;
    }
    return new Map<string, string>();
  }
}

function fallbackTitle(path: string): string {
  const basename = path.split('/').pop() ?? 'Capítulo';
  const title = basename.replace(/\.[^.]+$/u, '').replace(/[-_]+/gu, ' ');
  try {
    return decodeURIComponent(title);
  } catch {
    return title;
  }
}

function chapterTitleFromDocument(
  root: XmlElement,
  bookTitle: string,
): string | null {
  const headings = [...elements(root, 'h1'), ...elements(root, 'h2')];
  const matchingBookTitle = headings.find(
    (heading) =>
      normalizedLabel(textContent(heading)) === normalizedLabel(bookTitle),
  );
  if (matchingBookTitle) {
    return normalizeWhitespace(textContent(matchingBookTitle)).trim();
  }

  for (const heading of headings) {
    const title = normalizeWhitespace(textContent(heading)).trim();
    if (title && !isBoilerplateText(title) && !isYear(title)) {
      return title;
    }
  }

  const body = elements(root, 'body')[0] ?? root;
  for (const block of contentBlocks(body)) {
    const title = normalizeWhitespace(textContent(block)).trim();
    if (
      title &&
      title.length <= 100 &&
      !isBoilerplateText(title) &&
      !isYear(title) &&
      !isRomanNumeral(title) &&
      !/[.!?]$/u.test(title)
    ) {
      return title;
    }
  }
  return null;
}

const CONTENT_BLOCK_NAMES = new Set([
  'blockquote',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'img',
  'ol',
  'p',
  'pre',
  'table',
  'ul',
]);

const CONTENT_CONTAINERS = new Set([
  'article',
  'body',
  'center',
  'div',
  'main',
  'section',
]);

function contentBlocks(root: XmlElement): XmlElement[] {
  const result: XmlElement[] = [];
  const visit = (node: XmlNode): void => {
    if (node.kind !== 'element') {
      return;
    }
    if (CONTENT_BLOCK_NAMES.has(node.name)) {
      result.push(node);
      return;
    }
    if (CONTENT_CONTAINERS.has(node.name)) {
      for (const child of node.children) {
        visit(child);
      }
      return;
    }
    result.push(node);
  };

  visit(root);
  return result;
}

function isBoilerplateText(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  return (
    /libro descargado en www\.elejandria\.com/u.test(text) ||
    /gracias por leer este libro/u.test(text) ||
    /descubre nuestra colección de obras/u.test(text)
  );
}

function isYear(value: string): boolean {
  return /^\d{4}[.]?$/u.test(value.trim());
}

function isRomanNumeral(value: string): boolean {
  return /^(?=[ivxlcdm]+$)[ivxlcdm]+[.]?$/iu.test(value.trim());
}

function romanNumeralValue(value: string): number | null {
  const numeral = value.replace(/[.]$/u, '').toUpperCase();
  if (!isRomanNumeral(numeral)) {
    return null;
  }

  const values: Record<string, number> = {
    I: 1,
    V: 5,
    X: 10,
    L: 50,
    C: 100,
    D: 500,
    M: 1000,
  };
  let total = 0;
  for (let index = 0; index < numeral.length; index += 1) {
    const current = values[numeral[index]!]!;
    const next = values[numeral[index + 1] ?? ''] ?? 0;
    total += current < next ? -current : current;
  }
  return total;
}

function leadingRomanChapterNumber(title: string): number | null {
  const match = /^\s*([ivxlcdm]+)[.)]\s+/iu.exec(title);
  return match ? romanNumeralValue(match[1]!) : null;
}

function appendContent(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): boolean {
  const targetNodes = target['content'];
  const sourceNodes = source['content'];
  if (!Array.isArray(targetNodes) || !Array.isArray(sourceNodes)) {
    return false;
  }

  target['content'] = [
    ...(targetNodes as unknown[]),
    ...(sourceNodes as unknown[]),
  ];
  return true;
}

function normalizedLabel(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase();
}

function isGenericNavigationTitle(value: string | undefined): boolean {
  return ['start', 'inicio', 'home', 'contents', 'table of contents'].includes(
    normalizedLabel(value),
  );
}

function isFrontMatterDocument(
  path: string,
  navigationTitle: string | undefined,
  root: XmlElement,
): boolean {
  const decodedPath = (() => {
    try {
      return decodeURIComponent(path);
    } catch {
      return path;
    }
  })();
  const normalizedPath = normalizedLabel(decodedPath).replaceAll('\\', '/');
  const fileName = normalizedPath.split('/').pop() ?? normalizedPath;
  if (
    /^(?:cover(?:page)?|title(?:page)?|portada|titulo|nav|toc|contents?|about|acerca|colophon|copyright|elejandria)(?:[._-]|$)/u.test(
      fileName,
    )
  ) {
    return true;
  }

  const label = normalizedLabel(navigationTitle);
  if (
    ['cover', 'portada', 'title', 'titulo', 'acerca', 'about'].includes(label)
  ) {
    return true;
  }

  const body = elements(root, 'body')[0] ?? root;
  const visibleText = contentBlocks(body)
    .map((block) => textContent(block))
    .join(' ');
  const wordCount = visibleText.trim().split(/\s+/u).filter(Boolean).length;
  return isBoilerplateText(visibleText) && wordCount < 180;
}

interface ContentBoundary {
  kind: 'chapter' | 'scene';
  title: string;
  consumeNext?: boolean;
}

const CHAPTER_PREFIXES = new Set([
  'acto',
  'act',
  'capitulo',
  'chapter',
  'parte',
  'part',
]);
const SCENE_PREFIXES = new Set(['escena', 'scene']);
const CHAPTER_ORDINALS = new Set([
  'primero',
  'primera',
  'segundo',
  'segunda',
  'tercero',
  'tercera',
  'cuarto',
  'cuarta',
  'quinto',
  'quinta',
  'sexto',
  'sexta',
  'septimo',
  'septima',
  'octavo',
  'octava',
  'noveno',
  'novena',
  'decimo',
  'decima',
]);
const SCENE_ORDINALS = new Set([
  'primera',
  'primero',
  'segunda',
  'segundo',
  'tercera',
  'tercero',
  'cuarta',
  'cuarto',
  'quinta',
  'quinto',
  'sexta',
  'sexto',
  'septima',
  'septimo',
  'octava',
  'octavo',
]);
const NAMED_CHAPTERS = new Set(['personajes', 'dedicatoria', 'prologo']);

function startsWithBoundaryNumber(
  label: string,
  prefixes: Set<string>,
  ordinals: Set<string>,
): boolean {
  const match = /^(\S+)\s+([a-z0-9]+)\b/u.exec(label);
  if (!match || !prefixes.has(match[1]!)) {
    return false;
  }
  const number = match[2]!;
  return (
    /^\d+$/u.test(number) || isRomanNumeral(number) || ordinals.has(number)
  );
}

function romanChapterBoundary(
  block: XmlElement,
  index: number,
  blocks: XmlElement[],
  romanChapterCount: number,
): ContentBoundary | null {
  if (
    romanChapterCount <= 1 ||
    !isRomanNumeral(normalizeWhitespace(textContent(block)).trim()) ||
    block.name !== 'p'
  ) {
    return null;
  }
  const next = blocks[index + 1];
  const nextText = next ? normalizeWhitespace(textContent(next)).trim() : '';
  const currentClass = attribute(block, 'class');
  const nextClass = next ? attribute(next, 'class') : undefined;
  if (
    next?.name !== 'p' ||
    !nextText ||
    nextText.length > 260 ||
    (currentClass && currentClass !== nextClass)
  ) {
    return null;
  }
  const numeral = normalizeWhitespace(textContent(block))
    .trim()
    .replace(/[.]$/u, '');
  return {
    kind: 'chapter',
    title: `${numeral}. ${nextText}`,
    consumeNext: true,
  };
}

function semanticChapterBoundary(
  block: XmlElement,
  label: string,
  bookTitle: string,
  text: string,
): ContentBoundary | null {
  const isSemanticHeading = block.name === 'h1' || block.name === 'h2';
  if (
    isSemanticHeading &&
    normalizedLabel(bookTitle) !== label &&
    !isGenericNavigationTitle(text) &&
    text.length <= 180
  ) {
    return { kind: 'chapter', title: text };
  }
  return null;
}

function structuralBoundary(
  block: XmlElement,
  index: number,
  blocks: XmlElement[],
  bookTitle: string,
  romanChapterCount: number,
): ContentBoundary | null {
  const text = normalizeWhitespace(textContent(block)).trim();
  const label = normalizedLabel(text);
  if (!text || isBoilerplateText(text) || isYear(text)) {
    return null;
  }

  if (startsWithBoundaryNumber(label, CHAPTER_PREFIXES, CHAPTER_ORDINALS)) {
    return { kind: 'chapter', title: text };
  }
  if (startsWithBoundaryNumber(label, SCENE_PREFIXES, SCENE_ORDINALS)) {
    return { kind: 'scene', title: text };
  }
  if (NAMED_CHAPTERS.has(label)) {
    return { kind: 'chapter', title: text };
  }
  if (label === 'introduccion') {
    return null;
  }

  const romanBoundary = romanChapterBoundary(
    block,
    index,
    blocks,
    romanChapterCount,
  );
  if (romanBoundary) {
    return romanBoundary;
  }

  return semanticChapterBoundary(block, label, bookTitle, text);
}

function meaningfulNavigationTitle(value: string | undefined): string | null {
  const title = value?.trim();
  if (
    !title ||
    isGenericNavigationTitle(title) ||
    isBoilerplateText(title) ||
    ['titulo', 'acerca', 'portada'].includes(normalizedLabel(title))
  ) {
    return null;
  }
  return title;
}

function preferredChapterTitle(
  navigationTitle: string | undefined,
  documentTitle: string | null,
  bookTitle: string,
  path: string,
): string {
  const navigation = meaningfulNavigationTitle(navigationTitle);
  const document = documentTitle?.trim();
  if (
    document &&
    normalizedLabel(document) === normalizedLabel(bookTitle) &&
    navigation
  ) {
    return document;
  }
  if (navigation) {
    return navigation;
  }
  if (document) {
    return document;
  }
  return fallbackTitle(path);
}

function parseContentGroup(
  blocks: XmlElement[],
  documentPath: string,
  catalog: ImageCatalog,
): Record<string, unknown> {
  const wrapper: XmlElement = {
    kind: 'element',
    name: 'div',
    attributes: {},
    children: blocks,
  };
  const content = parseBlocks(wrapper, documentPath, catalog);
  return {
    type: 'doc',
    content: content.length ? content : [{ type: 'paragraph' }],
  };
}

interface LogicalChapterState {
  chapters: EpubImportChapter[];
  currentChapter: EpubImportChapter | null;
  currentSceneTitle: string;
  currentSceneBlocks: XmlElement[];
  preludeBlocks: XmlElement[];
}

function contentBlocksWithoutPreamble(
  sourceBlocks: XmlElement[],
  bookTitle: string,
): XmlElement[] {
  const blocks = sourceBlocks.filter((block) => {
    const text = normalizeWhitespace(textContent(block)).trim();
    return text && !isBoilerplateText(text);
  });
  if (!blocks.length) {
    return [];
  }
  const firstContentIndex = blocks.findIndex((block) => {
    const text = normalizeWhitespace(textContent(block)).trim();
    return (
      !isYear(text) && normalizedLabel(text) !== normalizedLabel(bookTitle)
    );
  });
  return blocks.filter((block, index) => {
    if (index > 2) {
      return true;
    }
    const text = normalizeWhitespace(textContent(block)).trim();
    return (
      index >= firstContentIndex &&
      !isYear(text) &&
      normalizedLabel(text) !== normalizedLabel(bookTitle)
    );
  });
}

function flushLogicalScene(
  state: LogicalChapterState,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (!state.currentChapter || !state.currentSceneBlocks.length) {
    state.currentSceneBlocks = [];
    return;
  }
  state.currentChapter.scenes.push({
    title: state.currentSceneTitle,
    content: parseContentGroup(state.currentSceneBlocks, documentPath, catalog),
  });
  state.currentSceneBlocks = [];
}

function flushLogicalChapter(
  state: LogicalChapterState,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  flushLogicalScene(state, documentPath, catalog);
  if (state.currentChapter?.scenes.length) {
    state.chapters.push(state.currentChapter);
  }
  state.currentChapter = null;
  state.currentSceneTitle = 'Texto';
}

function processChapterBoundary(
  state: LogicalChapterState,
  boundary: ContentBoundary,
  defaultTitle: string,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (boundary.kind === 'chapter') {
    if (!state.currentChapter && state.preludeBlocks.length) {
      state.currentChapter = { title: 'Introducción', scenes: [] };
      state.currentSceneTitle = 'Texto';
      state.currentSceneBlocks = state.preludeBlocks;
      state.preludeBlocks = [];
    }
    flushLogicalChapter(state, documentPath, catalog);
    state.currentChapter = { title: boundary.title.slice(0, 200), scenes: [] };
    return;
  }

  if (!state.currentChapter) {
    state.currentChapter = { title: defaultTitle, scenes: [] };
    state.currentSceneTitle = 'Texto';
    state.currentSceneBlocks = state.preludeBlocks;
    state.preludeBlocks = [];
  }
  flushLogicalScene(state, documentPath, catalog);
  state.currentSceneTitle = boundary.title.slice(0, 200);
}

function finishLogicalChapters(
  state: LogicalChapterState,
  defaultTitle: string,
  documentPath: string,
  catalog: ImageCatalog,
): void {
  if (!state.currentChapter && state.preludeBlocks.length) {
    state.currentChapter = { title: defaultTitle, scenes: [] };
    state.currentSceneBlocks = state.preludeBlocks;
  } else if (state.preludeBlocks.length) {
    flushLogicalChapter(state, documentPath, catalog);
    state.currentChapter = { title: 'Introducción', scenes: [] };
    state.currentSceneBlocks = state.preludeBlocks;
  }
  flushLogicalChapter(state, documentPath, catalog);
}

function logicalChapters(
  sourceBlocks: XmlElement[],
  documentPath: string,
  catalog: ImageCatalog,
  bookTitle: string,
  defaultTitle: string,
): EpubImportChapter[] {
  const blocks = contentBlocksWithoutPreamble(sourceBlocks, bookTitle);
  if (!blocks.length) {
    return [];
  }

  const romanChapterCount = blocks.filter((block) =>
    isRomanNumeral(normalizeWhitespace(textContent(block)).trim()),
  ).length;

  const boundaries = blocks.map((block, index) =>
    structuralBoundary(block, index, blocks, bookTitle, romanChapterCount),
  );
  if (!boundaries.some(Boolean)) {
    return [
      {
        title: defaultTitle,
        scenes: [
          {
            title: 'Texto',
            content: parseContentGroup(blocks, documentPath, catalog),
          },
        ],
      },
    ];
  }

  const state: LogicalChapterState = {
    chapters: [],
    currentChapter: null,
    currentSceneTitle: 'Texto',
    currentSceneBlocks: [],
    preludeBlocks: [],
  };
  for (const [index, block] of blocks.entries()) {
    const boundary = boundaries[index];
    if (index > 0 && boundaries[index - 1]?.consumeNext) {
      continue;
    }
    if (boundary) {
      processChapterBoundary(
        state,
        boundary,
        defaultTitle,
        documentPath,
        catalog,
      );
      continue;
    }
    if (state.currentChapter) {
      state.currentSceneBlocks.push(block);
    } else {
      state.preludeBlocks.push(block);
    }
  }

  finishLogicalChapters(state, defaultTitle, documentPath, catalog);

  if (state.chapters.length === 1 && defaultTitle) {
    state.chapters[0]!.title = defaultTitle.slice(0, 200);
  }
  return state.chapters;
}

interface EpubPackage {
  opfPath: string;
  title: string;
  manifestById: Map<string, XmlElement>;
  spineItems: XmlElement[];
  navigationTitles: Map<string, string>;
}

async function loadEpubArchive(
  buffer: Buffer,
  budget: DecompressionBudget,
): Promise<JSZip> {
  if (buffer.length > MAX_EPUB_FILE_SIZE) {
    throw new EpubImportError('El EPUB no puede superar los 50 MB.');
  }
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new EpubImportError(
      'El archivo seleccionado no parece ser un EPUB válido.',
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new EpubImportError('No se pudo abrir el archivo EPUB.');
  }

  const entries = Object.values(zip.files).filter((file) => !file.dir);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new EpubImportError('El EPUB contiene demasiados archivos internos.');
  }
  const mimetype = zip.file('mimetype');
  if (
    !mimetype ||
    mimetype.dir ||
    (await readArchiveText(zip, 'mimetype', budget, 128)).trim() !==
      'application/epub+zip'
  ) {
    throw new EpubImportError(
      'El archivo no declara el formato EPUB requerido.',
    );
  }
  return zip;
}

async function readEpubPackage(
  zip: JSZip,
  budget: DecompressionBudget,
): Promise<EpubPackage> {
  const container = parseXml(
    await readArchiveText(zip, 'META-INF/container.xml', budget),
  );
  const rootfile = elements(container, 'rootfile')[0];
  const opfHref = rootfile ? attribute(rootfile, 'full-path') : undefined;
  if (!opfHref) {
    throw new EpubImportError('El EPUB no indica dónde está su catálogo.');
  }

  const opfPath = archivePath('META-INF/container.xml', `../${opfHref}`);
  const packageRoot = parseXml(await readArchiveText(zip, opfPath, budget));
  const metadata = elements(packageRoot, 'metadata')[0] ?? packageRoot;
  const titleNode = elements(metadata, 'title')[0];
  const title = titleNode ? textContent(titleNode).trim() : '';
  const manifest = elements(packageRoot, 'item');
  const spine = elements(packageRoot, 'spine')[0];
  if (!spine || !manifest.length) {
    throw new EpubImportError('El EPUB no contiene capítulos para importar.');
  }

  const manifestById = new Map(
    manifest
      .map((item) => [attribute(item, 'id') ?? '', item] as const)
      .filter(([id]) => id),
  );
  const navigationTitles = await tocTitles(zip, opfPath, manifest, budget);
  return {
    opfPath,
    title,
    manifestById,
    spineItems: elements(spine, 'itemref'),
    navigationTitles,
  };
}

function spineItemPath(
  itemref: XmlElement,
  packageData: EpubPackage,
  opfPath: string,
): string | null {
  if (attribute(itemref, 'linear') === 'no') {
    return null;
  }
  const item = packageData.manifestById.get(attribute(itemref, 'idref') ?? '');
  const href = item ? attribute(item, 'href') : undefined;
  const mediaType = item ? attribute(item, 'media-type') : undefined;
  if (
    !item ||
    !href ||
    !mediaType ||
    !XHTML_MEDIA_TYPES.has(mediaType.toLowerCase()) ||
    (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav')
  ) {
    return null;
  }
  return archivePath(opfPath, href);
}

async function parseSpineDocument(
  zip: JSZip,
  itemref: XmlElement,
  packageData: EpubPackage,
  opfPath: string,
  catalog: ImageCatalog,
  budget: DecompressionBudget,
): Promise<EpubImportChapter[]> {
  const path = spineItemPath(itemref, packageData, opfPath);
  if (!path) {
    return [];
  }
  const source = await readArchiveText(zip, path, budget);
  const root = parseXml(source);
  const navigationTitle = packageData.navigationTitles.get(path);
  if (isFrontMatterDocument(path, navigationTitle, root)) {
    return [];
  }

  await catalogImages(zip, root, path, catalog, budget);
  const body = elements(root, 'body')[0] ?? root;
  const documentTitle = chapterTitleFromDocument(root, packageData.title);
  const chapterTitle = preferredChapterTitle(
    navigationTitle,
    documentTitle,
    packageData.title,
    path,
  );
  return logicalChapters(
    contentBlocks(body),
    path,
    catalog,
    packageData.title,
    chapterTitle,
  );
}

function mergeLeadingIntroduction(
  chapters: EpubImportChapter[],
  documentChapters: EpubImportChapter[],
): void {
  const leadingFragment = documentChapters[0];
  const nextChapter = documentChapters[1];
  const previousChapter = chapters.at(-1);
  const previousNumber = previousChapter
    ? leadingRomanChapterNumber(previousChapter.title)
    : null;
  const nextNumber = nextChapter
    ? leadingRomanChapterNumber(nextChapter.title)
    : null;
  if (
    !leadingFragment ||
    normalizedLabel(leadingFragment.title) !== 'introduccion' ||
    leadingFragment.scenes.length !== 1 ||
    !previousChapter?.scenes.length ||
    previousNumber === null ||
    nextNumber !== previousNumber + 1
  ) {
    return;
  }
  const previousScene = previousChapter.scenes.at(-1);
  const fragmentScene = leadingFragment.scenes[0];
  if (previousScene && fragmentScene) {
    if (appendContent(previousScene.content, fragmentScene.content)) {
      documentChapters.shift();
    }
  }
}

async function parseSpine(
  zip: JSZip,
  opfPath: string,
  packageData: EpubPackage,
  catalog: ImageCatalog,
  budget: DecompressionBudget,
): Promise<EpubImportChapter[]> {
  const chapters: EpubImportChapter[] = [];
  await mapSequentially(packageData.spineItems, async (itemref) => {
    const documentChapters = await parseSpineDocument(
      zip,
      itemref,
      packageData,
      opfPath,
      catalog,
      budget,
    );
    mergeLeadingIntroduction(chapters, documentChapters);
    chapters.push(...documentChapters);
    if (chapters.length > 500) {
      throw new EpubImportError('El EPUB supera el máximo de 500 capítulos.');
    }
  });
  if (!chapters.length) {
    throw new EpubImportError('No se encontró texto importable en el EPUB.');
  }
  return chapters;
}

export async function parseEpubArchive(buffer: Buffer): Promise<ParsedEpub> {
  const budget: DecompressionBudget = { decompressedBytes: 0 };
  const zip = await loadEpubArchive(buffer, budget);
  const packageData = await readEpubPackage(zip, budget);
  const catalog: ImageCatalog = {
    bySource: new Map(),
    images: new Map(),
    skippedSources: new Set(),
  };
  const chapters = await parseSpine(
    zip,
    packageData.opfPath,
    packageData,
    catalog,
    budget,
  );

  return {
    title: (packageData.title.trim()
      ? packageData.title
      : (chapters[0]?.title ?? 'Obra importada')
    ).slice(0, 200),
    chapters,
    images: catalog.images,
    skippedImages: catalog.skippedSources.size,
  };
}

export function imageIdFromNode(node: Record<string, unknown>): string | null {
  const attrs = asRecord(node['attrs']);
  return typeof attrs?.['epubAssetId'] === 'string'
    ? attrs['epubAssetId']
    : null;
}
