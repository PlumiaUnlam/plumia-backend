import JSZip from 'jszip';
import {
  EpubImportError,
  MAX_EPUB_FILE_SIZE,
  parseEpubArchive,
} from './epub-import.parser';

async function createEpub(
  documents: Array<{ id: string; body: string }>,
  files: Record<string, Buffer | string> = {},
  navigation?: { href: string; body: string },
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/book.opf" /></rootfiles></container>',
  );
  const manifest = documents
    .map(
      ({ id }) =>
        `<item id="${id}" href="Text/${id}.xhtml" media-type="application/xhtml+xml" />`,
    )
    .join('');
  const spine = documents.map(({ id }) => `<itemref idref="${id}" />`).join('');
  const navigationItem = navigation
    ? `<item id="navigation" href="${navigation.href}" media-type="application/xhtml+xml" properties="nav" />`
    : '';
  zip.file(
    'OEBPS/book.opf',
    `<package><metadata><title>Libro de prueba</title></metadata><manifest>${navigationItem}${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  for (const { id, body } of documents) {
    zip.file(
      `OEBPS/Text/${id}.xhtml`,
      `<html><head><title>Libro de prueba</title></head><body>${body}</body></html>`,
    );
  }
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  if (navigation) {
    zip.file(`OEBPS/${navigation.href}`, navigation.body);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function textFrom(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(textFrom);
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(typeof record['text'] === 'string' ? [record['text']] : []),
    ...Object.entries(record)
      .filter(([key]) => key !== 'text')
      .flatMap(([, child]) => textFrom(child)),
  ];
}

function nodesOfType(value: unknown, type: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => nodesOfType(item, type));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(record['type'] === type ? [record] : []),
    ...Object.values(record).flatMap((child) => nodesOfType(child, type)),
  ];
}

describe('parseEpubArchive', () => {
  it('keeps a split chapter together when the next EPUB document starts mid-chapter', async () => {
    const epub = await createEpub([
      {
        id: 'part-one',
        body: '<h2>XXIV. La aventura anterior</h2><p>Final del capítulo veinticuatro.</p>',
      },
      {
        id: 'part-two',
        body: [
          '<p>El capítulo veinticuatro continúa aquí, antes del próximo título.</p>',
          '<p class="chapter">XXV</p>',
          '<p class="chapter">La promesa</p>',
          '<p>Empieza el capítulo veinticinco.</p>',
          '<p class="chapter">XXVI</p>',
          '<p class="chapter">La escuela</p>',
          '<p>Empieza el capítulo veintiséis.</p>',
        ].join(''),
      },
    ]);

    const parsed = await parseEpubArchive(epub);

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'XXIV. La aventura anterior',
      'XXV. La promesa',
      'XXVI. La escuela',
    ]);
    expect(parsed.chapters[0]?.scenes).toHaveLength(1);
    expect(
      textFrom(parsed.chapters[0]?.scenes[0]?.content).join(' '),
    ).toContain('continúa aquí');
  });

  it('creates chapters and scenes from act and scene headings', async () => {
    const epub = await createEpub([
      {
        id: 'play',
        body: [
          '<p>Acto Primero</p>',
          '<p>Escena I</p><p>Entran los personajes.</p>',
          '<p>Escena II</p><p>Continúa el diálogo.</p>',
          '<p>Acto Segundo</p>',
          '<p>Escena I</p><p>Comienza el segundo acto.</p>',
        ].join(''),
      },
    ]);

    const parsed = await parseEpubArchive(epub);

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Acto Primero',
      'Acto Segundo',
    ]);
    expect(parsed.chapters[0]?.scenes.map((scene) => scene.title)).toEqual([
      'Escena I',
      'Escena II',
    ]);
    expect(parsed.chapters[1]?.scenes.map((scene) => scene.title)).toEqual([
      'Escena I',
    ]);
  });

  it('uses navigation titles and excludes cover documents', async () => {
    const epub = await createEpub(
      [
        { id: 'cover', body: '<p>Portada</p>' },
        {
          id: 'chapter',
          body: '<h2>Título interno</h2><p>Texto del capítulo.</p>',
        },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><ol><li><a href="Text/chapter.xhtml">Capítulo desde índice</a></li></ol></nav></html>',
      },
    );

    const parsed = await parseEpubArchive(epub);

    expect(parsed.chapters).toHaveLength(1);
    expect(parsed.chapters[0]?.title).toBe('Capítulo desde índice');
  });

  it('preserves formatting and safe links while parsing lists', async () => {
    const epub = await createEpub([
      {
        id: 'formatted',
        body: [
          '<h2>Capítulo</h2>',
          '<p>Un <strong>texto destacado</strong>, un <a href="javascript:alert(1)">enlace inseguro</a> y un <a href="https://example.com">enlace seguro</a>.</p>',
          '<ul><li><p>Primer elemento</p></li></ul>',
        ].join(''),
      },
    ]);

    const parsed = await parseEpubArchive(epub);
    const textNodes = nodesOfType(parsed.chapters, 'text');

    expect(
      textNodes.find((node) => node['text'] === 'texto destacado')?.['marks'],
    ).toEqual([{ type: 'bold' }]);
    expect(
      textNodes.find((node) => node['text'] === 'enlace inseguro'),
    ).not.toHaveProperty('marks');
    expect(
      textNodes.find((node) => node['text'] === 'enlace seguro')?.['marks'],
    ).toEqual([{ type: 'link', attrs: { href: 'https://example.com' } }]);
    expect(nodesOfType(parsed.chapters, 'bulletList')).toHaveLength(1);
  });

  it('loads valid archive and data images and skips invalid or remote images', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const epub = await createEpub(
      [
        {
          id: 'illustrated',
          body: [
            '<h2>Capítulo ilustrado</h2>',
            '<p>Texto <img src="../Images/map.png" alt="Mapa" /></p>',
            `<p>Imagen integrada <img src="data:image/png;base64,${png.toString('base64')}" /></p>`,
            '<p><img src="https://example.com/remote.png" /></p>',
            '<p><img src="../Images/missing.jpg" /></p>',
            '<p><img src="data:image/png,%%%" /></p>',
          ].join(''),
        },
      ],
      { 'OEBPS/Images/map.png': png },
    );

    const parsed = await parseEpubArchive(epub);
    const images = nodesOfType(parsed.chapters, 'image');

    expect(parsed.images.has('epub-image-1')).toBe(true);
    expect(parsed.images.has('epub-image-2')).toBe(true);
    expect(parsed.skippedImages).toBe(3);
    expect(images).toHaveLength(2);
    expect(images.map((image) => image['attrs'])).toEqual([
      expect.objectContaining({
        alt: 'Mapa',
        epubAssetId: 'epub-image-1',
      }),
      expect.objectContaining({ epubAssetId: 'epub-image-2' }),
    ]);
  });

  it('detects supported image formats from their bytes', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
    const webp = Buffer.alloc(12);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    const avif = Buffer.alloc(12);
    avif.write('ftyp', 4);
    avif.write('avif', 8);
    const epub = await createEpub(
      [
        {
          id: 'formats',
          body: '<p>Imágenes <img src="../Images/a.jpg" /><img src="../Images/b.webp" /><img src="../Images/c.avif" /></p>',
        },
      ],
      {
        'OEBPS/Images/a.jpg': jpeg,
        'OEBPS/Images/b.webp': webp,
        'OEBPS/Images/c.avif': avif,
      },
    );

    const parsed = await parseEpubArchive(epub);

    expect(
      [...parsed.images.values()].map(({ contentType }) => contentType),
    ).toEqual(['image/jpeg', 'image/webp', 'image/avif']);
    expect(parsed.skippedImages).toBe(0);
  });

  it('skips an image that exceeds the per-image decompression limit', async () => {
    const oversizedImage = Buffer.alloc(13 * 1024 * 1024);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      oversizedImage,
    );
    const epub = await createEpub(
      [
        {
          id: 'large-image',
          body: '<p>Texto <img src="../Images/large.png" /></p>',
        },
      ],
      { 'OEBPS/Images/large.png': oversizedImage },
    );

    const parsed = await parseEpubArchive(epub);

    expect(parsed.images.size).toBe(0);
    expect(parsed.skippedImages).toBe(1);
    expect(textFrom(parsed.chapters).join(' ')).toContain('Texto');
  });

  it('rejects invalid archives, oversized uploads, and malformed XML', async () => {
    await expect(
      parseEpubArchive(Buffer.from('not an EPUB')),
    ).rejects.toBeInstanceOf(EpubImportError);
    await expect(
      parseEpubArchive(Buffer.alloc(MAX_EPUB_FILE_SIZE + 1)),
    ).rejects.toThrow('50 MB');

    const validEpub = await createEpub([
      { id: 'broken', body: '<p>Texto</p>' },
    ]);
    const zip = await JSZip.loadAsync(validEpub);
    zip.file('META-INF/container.xml', '<container>');
    const malformedEpub = await zip.generateAsync({ type: 'nodebuffer' });

    await expect(parseEpubArchive(malformedEpub)).rejects.toThrow(
      'documento XML inválido',
    );
  });
});
