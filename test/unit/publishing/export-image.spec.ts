import sharp from 'sharp';
import { prepareEpubImage } from '../../../src/publishing/exports/export-image';

async function createWebp(alpha = 1): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 70, g: 120, b: 190, alpha },
    },
  })
    .webp()
    .toBuffer();
}

async function createAvif(): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 70, g: 120, b: 190 },
    },
  })
    .avif()
    .toBuffer();
}

describe('EPUB image preparation', () => {
  it('converts opaque WebP images to JPEG without changing the source buffer', async () => {
    const source = await createWebp();
    const sourceCopy = Buffer.from(source);

    const result = await prepareEpubImage('scenes/scene/image.webp', source);

    expect(result.extension).toBe('jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect((await sharp(result.buffer).metadata()).format).toBe('jpeg');
    expect(source.equals(sourceCopy)).toBe(true);
  });

  it('keeps transparency when converting WebP images to PNG', async () => {
    const source = await createWebp(0.5);

    const result = await prepareEpubImage('scenes/scene/image.webp', source);

    expect(result.extension).toBe('png');
    expect(result.mimeType).toBe('image/png');
    expect((await sharp(result.buffer).metadata()).hasAlpha).toBe(true);
  });

  it('converts AVIF images to an EPUB-friendly JPEG', async () => {
    const source = await createAvif();

    const result = await prepareEpubImage('scenes/scene/image.avif', source);

    expect(result.extension).toBe('jpg');
    expect(result.mimeType).toBe('image/jpeg');
    expect((await sharp(result.buffer).metadata()).format).toBe('jpeg');
  });

  it('passes supported PNG data through without recompressing it', async () => {
    const source = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 70, g: 120, b: 190 },
      },
    })
      .png()
      .toBuffer();

    const result = await prepareEpubImage('scenes/scene/image.png', source);

    expect(result.buffer).toBe(source);
    expect(result.extension).toBe('png');
    expect(result.mimeType).toBe('image/png');
  });

  it('rejects unsupported image formats with a clear error', async () => {
    await expect(
      prepareEpubImage('scenes/scene/image.svg', Buffer.from('<svg />')),
    ).rejects.toThrow('No se puede exportar una imagen con formato svg');
  });
});
