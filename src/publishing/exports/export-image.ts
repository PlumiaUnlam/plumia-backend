import sharp from 'sharp';
import type { ExportImage } from './export.types';

type ImageFormat = Pick<ExportImage, 'extension' | 'mimeType'>;

function imageFormat(storageKey: string): ImageFormat {
  const extension = storageKey.split('.').pop()?.toLowerCase() ?? '';
  switch (extension) {
    case 'jpg':
    case 'jpeg':
      return { extension: 'jpg', mimeType: 'image/jpeg' };
    case 'png':
      return { extension: 'png', mimeType: 'image/png' };
    case 'gif':
      return { extension: 'gif', mimeType: 'image/gif' };
    case 'bmp':
      return { extension: 'bmp', mimeType: 'image/bmp' };
    case 'webp':
    case 'avif':
      return { extension, mimeType: `image/${extension}` };
    default:
      throw new Error(
        `No se puede exportar una imagen con formato ${extension || 'desconocido'}`,
      );
  }
}

export async function prepareEpubImage(
  storageKey: string,
  buffer: Buffer,
): Promise<ExportImage> {
  const sourceFormat = imageFormat(storageKey);
  if (sourceFormat.extension !== 'webp' && sourceFormat.extension !== 'avif') {
    return { ...sourceFormat, buffer };
  }

  const metadata = await sharp(buffer).metadata();
  if (metadata.hasAlpha) {
    return {
      extension: 'png',
      mimeType: 'image/png',
      buffer: await sharp(buffer).rotate().png().toBuffer(),
    };
  }

  return {
    extension: 'jpg',
    mimeType: 'image/jpeg',
    buffer: await sharp(buffer).rotate().jpeg({ quality: 92 }).toBuffer(),
  };
}
