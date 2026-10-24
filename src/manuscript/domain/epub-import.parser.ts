import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

type JSZipObject = JSZip.JSZipObject;

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

type XmlText = { kind: 'text'; value: string };
type XmlElement = {
  kind: 'element';
  name: string;
  attributes: Record<string, string>;
  children: XmlNode[];
};
type XmlNode = XmlText | XmlElement;

export type EpubImportImage = {
  id: string;
  buffer: Buffer;
  contentType: string;
  extension: string;
};

export interface EpubImportScene {
  title: string;
  content: Record<string, unknown>;
}

export interface EpubImportChapter {
  title: string;
  scenes: EpubImportScene[];
}

export type ParsedEpub = {
  title: string;
  chapters: EpubImportChapter[];
  images: Map<string, EpubImportImage>;
  skippedImages: number;
};

type ImageCatalog = {
  bySource: Map<string, string | null>;
  images: Map<string, EpubImportImage>;
  skippedSources: Set<string>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseOrderedNodes(value: unknown): XmlNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: XmlNode[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) {
      continue;
    }

    if ('#text' in record) {
      const text = record['#text'];
      if (typeof text === 'string' && text) {
        result.push({ kind: 'text', value: text });
      }
      continue;
    }

    const rawAttributes = asRecord(record[':@']) ?? {};
    const attributes: Record<string, string> = {};
    for (const [key, attributeValue] of Object.entries(rawAttributes)) {
      if (key.startsWith('@_') && typeof attributeValue === 'string') {
        attributes[key.slice(2).toLowerCase()] = attributeValue;
      }
    }

    for (const [name, children] of Object.entries(record)) {
      if (
        name === ':@' ||
        name.startsWith('#') ||
        name.startsWith('?') ||
        name.startsWith('!')
      ) {
        continue;
      }

      result.push({
        kind: 'element',
        name: name.toLowerCase(),
        attributes,
        children: parseOrderedNodes(children),
      });
    }
  }

  return result;
}

function parseXml(xml: string): XmlElement {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new BadRequestException(
      'El EPUB contiene un documento XML inválido.',
    );
  }

  const root = parseOrderedNodes(XML_PARSER.parse(xml)).find(
    (node): node is XmlElement => node.kind === 'element',
  );
  if (!root) {
    throw new BadRequestException('El EPUB no contiene documentos válidos.');
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
    throw new BadRequestException(
      'El EPUB contiene una ruta de archivo inválida.',
    );
  }

  if (url.origin !== 'https://epub.invalid') {
    throw new BadRequestException(
      'El EPUB contiene una ruta externa inválida.',
    );
  }

  try {
    return decodeURIComponent(url.pathname.replace(/^\/+/, ''));
  } catch {
    throw new BadRequestException(
      'El EPUB contiene una ruta de archivo inválida.',
    );
  }
}

function zipUncompressedSize(file: JSZipObject): number {
  const internal = file as JSZipObject & {
    _data?: { uncompressedSize?: number };
  };
  return internal._data?.uncompressedSize ?? 0;
}

async function readArchiveText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file || file.dir || zipUncompressedSize(file) > MAX_XML_ENTRY_SIZE) {
    throw new BadRequestException('El EPUB está incompleto o dañado.');
  }
  return file.async('string');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, ' ');
}

function trimInlineEdges(nodes: Record<string, unknown>[]): void {
  const textNodes = nodes.filter(
    (node) => node['type'] === 'text' && typeof node['text'] === 'string',
  );
  const first = textNodes[0];
  const last = textNodes[textNodes.length - 1];
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
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(?:px)?$/i);
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
    numberWidth(style.match(/(?:^|;)\s*width\s*:\s*([^;]+)/i)?.[1]);
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
  const match = source.match(
    /divider-(flourish|diamonds|stars|waves|dots|asterisks|moon)(?:-[0-9a-f]{6})?\.svg(?:[?#]|$)/i,
  );
  const style = attribute(element, 'style') ?? '';
  const color = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{6})/i)?.[1];
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

    const tag = child.name;
    if (
      tag === 'script' ||
      tag === 'style' ||
      tag === 'head' ||
      tag === 'title'
    ) {
      continue;
    }
    const isBlock = [
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
    ].includes(tag);

    if (!isBlock) {
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
    if (tag === 'p') {
      result.push(...paragraph(child, documentPath, catalog));
    } else if (/^h[1-6]$/u.test(tag)) {
      const content = inlineNodes(child.children);
      trimInlineEdges(content);
      if (content.length) {
        result.push({
          type: 'heading',
          attrs: { level: Number(tag.slice(1)) },
          content,
        });
      }
    } else if (tag === 'hr') {
      result.push({ type: 'horizontalRule' });
    } else if (tag === 'img') {
      result.push(...makeImageNode(child, element, documentPath, catalog));
    } else if (tag === 'ul' || tag === 'ol') {
      const listItems = child.children
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
      if (listItems.length) {
        result.push({
          type: tag === 'ul' ? 'bulletList' : 'orderedList',
          ...(tag === 'ol' && attribute(child, 'start')
            ? { attrs: { start: Number(attribute(child, 'start')) || 1 } }
            : {}),
          content: listItems,
        });
      }
    } else if (tag === 'blockquote') {
      const content = parseBlocks(child, documentPath, catalog);
      if (content.length) {
        result.push({ type: 'blockquote', content });
      }
    } else if (tag === 'pre') {
      const text = textContent(child);
      if (text) {
        result.push({
          type: 'codeBlock',
          content: [{ type: 'text', text }],
        });
      }
    } else {
      result.push(...parseBlocks(child, documentPath, catalog));
    }
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
  const extension = withoutQuery.match(/\.[^./]+$/u)?.[0]?.toLowerCase();
  return extension ? (IMAGE_TYPES[extension] ?? null) : null;
}

function dataImage(source: string): {
  buffer: Buffer;
  contentType: string;
} | null {
  const match = source.match(
    /^data:(image\/(?:jpeg|png|webp|avif));([^,]*),(.*)$/is,
  );
  if (!match?.[1] || match[2] === undefined || match[3] === undefined) {
    return null;
  }
  try {
    const buffer = match[2].toLowerCase().includes('base64')
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]));
    return { buffer, contentType: match[1].toLowerCase() };
  } catch {
    return null;
  }
}

async function loadImageAsset(
  zip: JSZip,
  source: string,
  key: string,
): Promise<EpubImportImage | null> {
  let buffer: Buffer;
  let contentType: string;
  if (source.startsWith('data:')) {
    const image = dataImage(source);
    if (!image) {
      return null;
    }
    ({ buffer, contentType } = image);
  } else {
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(source)) {
      return null;
    }
    const type = imageTypeFromSource(key);
    const file = zip.file(key);
    if (
      !type ||
      !file ||
      file.dir ||
      zipUncompressedSize(file) > MAX_IMAGE_SIZE
    ) {
      return null;
    }
    buffer = await file.async('nodebuffer');
    contentType = type.contentType;
  }

  if (!buffer.length || buffer.length > MAX_IMAGE_SIZE) {
    return null;
  }
  const extension =
    Object.entries(IMAGE_TYPES).find(
      ([, type]) => type.contentType === contentType,
    )?.[1].extension ?? 'jpg';
  return { id: '', buffer, contentType, extension };
}

async function catalogImages(
  zip: JSZip,
  documentRoot: XmlElement,
  documentPath: string,
  catalog: ImageCatalog,
): Promise<void> {
  const imageElements = imagesOutsideDividers(documentRoot);
  for (const image of imageElements) {
    const source = attribute(image, 'src');
    if (!source) {
      continue;
    }
    const key = imageSourceKey(documentPath, source);
    if (catalog.bySource.has(key)) {
      continue;
    }
    if (catalog.images.size >= MAX_IMAGES) {
      catalog.bySource.set(key, null);
      catalog.skippedSources.add(key);
      continue;
    }

    const asset = await loadImageAsset(zip, source, key);
    if (!asset) {
      catalog.bySource.set(key, null);
      catalog.skippedSources.add(key);
      continue;
    }
    const id = `epub-image-${catalog.images.size + 1}`;
    catalog.images.set(id, { ...asset, id });
    catalog.bySource.set(key, id);
  }
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

function tocTitles(
  zip: JSZip,
  opfPath: string,
  manifest: XmlElement[],
): Promise<Map<string, string>> {
  const navItem = manifest.find((item) =>
    (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav'),
  );
  const ncxItem = manifest.find(
    (item) => attribute(item, 'media-type') === 'application/x-dtbncx+xml',
  );
  const item = navItem ?? ncxItem;
  const href = item ? attribute(item, 'href') : undefined;
  if (!href) {
    return Promise.resolve(new Map());
  }

  const navPath = archivePath(opfPath, href);
  return readArchiveText(zip, navPath)
    .then((source) => {
      const root = parseXml(source);
      const titles = new Map<string, string>();
      if (item === navItem) {
        for (const link of elements(root, 'a')) {
          const linkHref = attribute(link, 'href');
          const label = textContent(link).trim();
          if (linkHref && label) {
            titles.set(archivePath(navPath, linkHref), label);
          }
        }
      } else {
        for (const point of elements(root, 'navpoint')) {
          const content = elements(point, 'content')[0];
          const navLabel = elements(point, 'text')[0];
          const contentSrc = content ? attribute(content, 'src') : undefined;
          const label = navLabel ? textContent(navLabel).trim() : '';
          if (contentSrc && label) {
            titles.set(archivePath(navPath, contentSrc), label);
          }
        }
      }
      return titles;
    })
    .catch(() => new Map());
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

  const actOrChapter =
    /^(?:acto|act|cap[ií]tulo|chapter|parte|part)\s+(?:[ivxlcdm]+|\d+|primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta|quinto|quinta|sexto|sexta|septimo|septima|octavo|octava|noveno|novena|decimo|decima)\b/iu;
  if (actOrChapter.test(label)) {
    return { kind: 'chapter', title: text };
  }
  if (
    /^(?:escena|scene)\s+(?:[ivxlcdm]+|\d+|primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|quinta|quinto|sexta|sexto|septima|septimo|octava|octavo)\b/iu.test(
      text,
    )
  ) {
    return { kind: 'scene', title: text };
  }
  if (['personajes', 'dedicatoria', 'prologo'].includes(label)) {
    return { kind: 'chapter', title: text };
  }
  if (label === 'introduccion') {
    return null;
  }

  if (romanChapterCount > 1 && isRomanNumeral(text) && block.name === 'p') {
    const next = blocks[index + 1];
    const nextText = next ? normalizeWhitespace(textContent(next)).trim() : '';
    const currentClass = attribute(block, 'class');
    const nextClass = next ? attribute(next, 'class') : undefined;
    if (
      next?.name === 'p' &&
      nextText.length > 0 &&
      nextText.length <= 260 &&
      (!currentClass || currentClass === nextClass)
    ) {
      return {
        kind: 'chapter',
        title: `${text.replace(/[.]$/u, '')}. ${nextText}`,
        consumeNext: true,
      };
    }
  }

  const normalizedBookTitle = normalizedLabel(bookTitle);
  const isSemanticHeading = ['h1', 'h2'].includes(block.name);
  if (
    isSemanticHeading &&
    normalizedBookTitle !== label &&
    !isGenericNavigationTitle(text) &&
    text.length <= 180
  ) {
    return { kind: 'chapter', title: text };
  }
  return null;
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

function logicalChapters(
  sourceBlocks: XmlElement[],
  documentPath: string,
  catalog: ImageCatalog,
  bookTitle: string,
  defaultTitle: string,
): EpubImportChapter[] {
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
  const contentBlocksWithoutPreamble = blocks.filter((block, index) => {
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
  const romanChapterCount = contentBlocksWithoutPreamble.filter((block) =>
    isRomanNumeral(normalizeWhitespace(textContent(block)).trim()),
  ).length;

  const boundaries = contentBlocksWithoutPreamble.map((block, index) =>
    structuralBoundary(
      block,
      index,
      contentBlocksWithoutPreamble,
      bookTitle,
      romanChapterCount,
    ),
  );
  if (!boundaries.some(Boolean)) {
    return [
      {
        title: defaultTitle,
        scenes: [
          {
            title: 'Texto',
            content: parseContentGroup(
              contentBlocksWithoutPreamble,
              documentPath,
              catalog,
            ),
          },
        ],
      },
    ];
  }

  const chapters: EpubImportChapter[] = [];
  let currentChapter: EpubImportChapter | null = null;
  let currentSceneTitle = 'Texto';
  let currentSceneBlocks: XmlElement[] = [];
  let preludeBlocks: XmlElement[] = [];

  const flushScene = (): void => {
    if (!currentChapter || !currentSceneBlocks.length) {
      currentSceneBlocks = [];
      return;
    }
    currentChapter.scenes.push({
      title: currentSceneTitle,
      content: parseContentGroup(currentSceneBlocks, documentPath, catalog),
    });
    currentSceneBlocks = [];
  };

  const flushChapter = (): void => {
    flushScene();
    if (currentChapter?.scenes.length) {
      chapters.push(currentChapter);
    }
    currentChapter = null;
    currentSceneTitle = 'Texto';
  };

  const startChapter = (title: string): void => {
    flushChapter();
    currentChapter = { title: title.slice(0, 200), scenes: [] };
  };

  for (const [index, block] of contentBlocksWithoutPreamble.entries()) {
    const boundary = boundaries[index];
    if (index > 0 && boundaries[index - 1]?.consumeNext) {
      continue;
    }
    if (boundary?.kind === 'chapter') {
      if (!currentChapter && preludeBlocks.length) {
        currentChapter = { title: 'Introducción', scenes: [] };
        currentSceneTitle = 'Texto';
        currentSceneBlocks = preludeBlocks;
        preludeBlocks = [];
      }
      startChapter(boundary.title);
      continue;
    }

    if (boundary?.kind === 'scene') {
      currentChapter ??= { title: defaultTitle, scenes: [] };
      flushScene();
      currentSceneTitle = boundary.title.slice(0, 200);
      continue;
    }

    if (currentChapter) {
      currentSceneBlocks.push(block);
    } else {
      preludeBlocks.push(block);
    }
  }

  if (!currentChapter && preludeBlocks.length) {
    currentChapter = { title: defaultTitle, scenes: [] };
    currentSceneBlocks = preludeBlocks;
  } else if (preludeBlocks.length) {
    flushChapter();
    currentChapter = { title: 'Introducción', scenes: [] };
    currentSceneBlocks = preludeBlocks;
  }
  flushChapter();

  if (chapters.length === 1 && defaultTitle) {
    chapters[0]!.title = defaultTitle.slice(0, 200);
  }
  return chapters;
}

export async function parseEpubArchive(buffer: Buffer): Promise<ParsedEpub> {
  if (buffer.length > MAX_EPUB_FILE_SIZE) {
    throw new BadRequestException('El EPUB no puede superar los 50 MB.');
  }
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new BadRequestException(
      'El archivo seleccionado no parece ser un EPUB válido.',
    );
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new BadRequestException('No se pudo abrir el archivo EPUB.');
  }

  const entries = Object.values(zip.files).filter((file) => !file.dir);
  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new BadRequestException(
      'El EPUB contiene demasiados archivos internos.',
    );
  }
  const uncompressedSize = entries.reduce(
    (total, file) => total + zipUncompressedSize(file),
    0,
  );
  if (uncompressedSize > MAX_UNCOMPRESSED_ARCHIVE_SIZE) {
    throw new BadRequestException(
      'El EPUB excede el tamaño descomprimido permitido.',
    );
  }

  const mimetype = zip.file('mimetype');
  if (
    !mimetype ||
    (await mimetype.async('string')).trim() !== 'application/epub+zip'
  ) {
    throw new BadRequestException(
      'El archivo no declara el formato EPUB requerido.',
    );
  }

  const container = parseXml(
    await readArchiveText(zip, 'META-INF/container.xml'),
  );
  const rootfile = elements(container, 'rootfile')[0];
  const opfHref = rootfile ? attribute(rootfile, 'full-path') : undefined;
  if (!opfHref) {
    throw new BadRequestException('El EPUB no indica dónde está su catálogo.');
  }

  const opfPath = archivePath('META-INF/container.xml', `../${opfHref}`);
  const packageRoot = parseXml(await readArchiveText(zip, opfPath));
  const metadata = elements(packageRoot, 'metadata')[0] ?? packageRoot;
  const title = elements(metadata, 'title')[0]
    ? textContent(elements(metadata, 'title')[0]!).trim()
    : '';
  const manifest = elements(packageRoot, 'item');
  const spine = elements(packageRoot, 'spine')[0];
  if (!spine || !manifest.length) {
    throw new BadRequestException(
      'El EPUB no contiene capítulos para importar.',
    );
  }

  const manifestById = new Map(
    manifest
      .map((item) => [attribute(item, 'id') ?? '', item] as const)
      .filter(([id]) => id),
  );
  const nav = await tocTitles(zip, opfPath, manifest);
  const catalog: ImageCatalog = {
    bySource: new Map(),
    images: new Map(),
    skippedSources: new Set(),
  };
  const chapters: EpubImportChapter[] = [];

  for (const itemref of elements(spine, 'itemref')) {
    if (attribute(itemref, 'linear') === 'no') {
      continue;
    }
    const item = manifestById.get(attribute(itemref, 'idref') ?? '');
    const href = item ? attribute(item, 'href') : undefined;
    const mediaType = item ? attribute(item, 'media-type') : undefined;
    if (
      !item ||
      !href ||
      !mediaType ||
      !XHTML_MEDIA_TYPES.has(mediaType.toLowerCase()) ||
      (attribute(item, 'properties') ?? '').split(/\s+/u).includes('nav')
    ) {
      continue;
    }

    const path = archivePath(opfPath, href);
    const source = await readArchiveText(zip, path);
    const root = parseXml(source);
    const body = elements(root, 'body')[0] ?? root;
    const navigationTitle = nav.get(path);
    if (isFrontMatterDocument(path, navigationTitle, root)) {
      continue;
    }

    await catalogImages(zip, root, path, catalog);
    const blocks = contentBlocks(body);
    const documentTitle = chapterTitleFromDocument(root, title);
    const chapterTitle = preferredChapterTitle(
      navigationTitle,
      documentTitle,
      title,
      path,
    );
    const documentChapters = logicalChapters(
      blocks,
      path,
      catalog,
      title,
      chapterTitle,
    );
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
      leadingFragment &&
      normalizedLabel(leadingFragment.title) === 'introduccion' &&
      leadingFragment.scenes.length === 1 &&
      previousChapter?.scenes.length &&
      previousNumber !== null &&
      nextNumber === previousNumber + 1
    ) {
      const previousScene = previousChapter.scenes.at(-1);
      const fragmentScene = leadingFragment.scenes[0];
      if (
        previousScene &&
        fragmentScene &&
        appendContent(previousScene.content, fragmentScene.content)
      ) {
        documentChapters.shift();
      }
    }

    chapters.push(...documentChapters);
    if (chapters.length > 500) {
      throw new BadRequestException(
        'El EPUB supera el máximo de 500 capítulos.',
      );
    }
  }

  if (!chapters.length) {
    throw new BadRequestException(
      'No se encontró texto importable en el EPUB.',
    );
  }

  return {
    title: (title.trim()
      ? title
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
