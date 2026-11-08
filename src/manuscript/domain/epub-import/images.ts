import type JSZip from 'jszip';
import { mapSequentially } from '../../../common/async.utils';
import { archivePath, readArchiveBytes, attribute } from './archive';
import type {
  DecompressionBudget,
  EpubImportImage,
  XmlElement,
  ImageCatalog,
  XmlNode,
} from './types';
import { ArchiveEntryTooLargeError } from './types';

const MAX_IMAGE_SIZE = 12 * 1024 * 1024;

const MAX_IMAGES = 200;

const IMAGE_TYPES: Record<string, { contentType: string; extension: string }> =
  {
    '.jpg': { contentType: 'image/jpeg', extension: 'jpg' },
    '.jpeg': { contentType: 'image/jpeg', extension: 'jpg' },
    '.png': { contentType: 'image/png', extension: 'png' },
    '.webp': { contentType: 'image/webp', extension: 'webp' },
    '.avif': { contentType: 'image/avif', extension: 'avif' },
  };

export function imageSourceKey(documentPath: string, source: string): string {
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
    (!imageTypeFromSource(key) && /\.[^./]+$/u.test(key))
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

export async function catalogImages(
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
