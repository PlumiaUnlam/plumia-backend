import JSZip from 'jszip';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import type {
  XmlNode,
  XmlElement,
  JSZipNodeStream,
  JSZipObject,
  DecompressionBudget,
} from './types';
import {
  EpubImportError,
  EpubArchiveLimitError,
  ArchiveEntryTooLargeError,
} from './types';

const MAX_ARCHIVE_ENTRIES = 5_000;

const MAX_UNCOMPRESSED_ARCHIVE_SIZE = 250 * 1024 * 1024;

const MAX_XML_ENTRY_SIZE = 30 * 1024 * 1024;

export const MAX_EPUB_FILE_SIZE = 50 * 1024 * 1024;

const XML_PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  htmlEntities: true,
  // Spaces around inline elements belong to the prose, including whitespace-only nodes.
  trimValues: false,
});

export function asRecord(value: unknown): Record<string, unknown> | null {
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

export function parseXml(xml: string): XmlElement {
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

export function elements(node: XmlNode, name: string): XmlElement[] {
  if (node.kind !== 'element') {
    return [];
  }

  const matches = node.name === name ? [node] : [];
  return matches.concat(...node.children.map((child) => elements(child, name)));
}

export function textContent(node: XmlNode): string {
  if (node.kind === 'text') {
    return node.value;
  }
  return node.children.map(textContent).join('');
}

export function attribute(node: XmlElement, name: string): string | undefined {
  return node.attributes[name.toLowerCase()];
}

export function archivePath(baseFile: string, reference: string): string {
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

function abortArchiveStream(stream: JSZipNodeStream): void {
  stream._helper?.pause();
  stream.destroy();
}

export function readArchiveBytes(
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

export async function readArchiveText(
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

export function normalizeWhitespace(value: string): string {
  return value.replace(/[\u00ad\u200b\ufeff]/gu, '').replace(/\s+/gu, ' ');
}

export function appendContent(
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

export function normalizedLabel(value: string | undefined): string {
  return normalizeWhitespace(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/gu, '')
    .trim()
    .toLowerCase();
}

/** Returns identifiers preserved at this block's start, including flattened containers. */
export function blockIds(block: XmlElement): string[] {
  const ownId = attribute(block, 'id');
  return [
    ...(block.boundaryIds ?? []),
    ...(ownId ? [ownId] : []),
    ...allElementIds(block),
  ];
}

function allElementIds(node: XmlElement): string[] {
  return node.children.flatMap((child) =>
    child.kind === 'element'
      ? [
          ...(attribute(child, 'id') ? [attribute(child, 'id')!] : []),
          ...allElementIds(child),
        ]
      : [],
  );
}

export async function loadEpubArchive(
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

export function documentHasText(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(documentHasText);
  }
  const node = asRecord(value);
  return (
    node !== null &&
    ((typeof node['text'] === 'string' && Boolean(node['text'].trim())) ||
      documentHasText(node['content']))
  );
}
