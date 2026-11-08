import JSZip from 'jszip';
import { parseEpubArchive } from './epub-import.parser';
import {
  createEpub,
  nodesOfType,
  textFrom,
} from '../../../test/fixtures/epub-import';

describe('EPUB import resilience', () => {
  it('rejects archives with too many entries before importing their content', async () => {
    const zip = await JSZip.loadAsync(
      await createEpub([{ id: 'story', body: '<p>Historia.</p>' }]),
    );
    for (let index = 0; index < 5_001; index += 1) {
      zip.file(`extra/${index}.txt`, '');
    }

    await expect(
      parseEpubArchive(await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toThrow('demasiados archivos internos');
  });

  it('limits image imports without dropping narrative text when the image limit is exceeded', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const images = Array.from({ length: 201 }, (_, index) => index);
    const files = Object.fromEntries(
      images.map((index) => [`OEBPS/Images/${index}.png`, png]),
    );
    const illustrations = images
      .map((index) => `<p><img src="../Images/${index}.png" /></p>`)
      .join('');
    const body = `<h1>La historia</h1><p>Antes.</p>${illustrations}<p>Después.</p>`;

    const parsed = await parseEpubArchive(
      await createEpub([{ id: 'story', body }], files),
    );

    expect(parsed.images.size).toBe(200);
    expect(parsed.skippedImages).toBe(1);
    expect(nodesOfType(parsed.chapters, 'image')).toHaveLength(200);
    expect(textFrom(parsed.chapters).join('')).toBe('Antes.Después.');
  });

  it('detects AVIF compatible brands and skips malformed inline images while keeping the story', async () => {
    const avif = Buffer.alloc(20);
    avif.write('ftyp', 4);
    avif.write('mif1', 8);
    avif.write('avif', 16);

    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<h1>La historia</h1><p>Texto intacto.</p><p><img src="../Images/a.avif" /></p><p><img src="data:image/png;charset=utf-8,%ZZ" /></p>',
          },
        ],
        { 'OEBPS/Images/a.avif': avif },
      ),
    );

    expect(
      [...parsed.images.values()].map((image) => image.contentType),
    ).toEqual(['image/avif']);
    expect(parsed.skippedImages).toBe(1);
    expect(textFrom(parsed.chapters).join('')).toBe('Texto intacto.');
  });

  it.each(['missing', 'malformed'])(
    'imports the story with its own heading when optional navigation is %s',
    async (navigationState) => {
      const zip = await JSZip.loadAsync(
        await createEpub(
          [
            {
              id: 'story',
              body: '<h1>La llegada</h1><p>La historia sigue intacta.</p>',
            },
          ],
          {},
          { href: 'nav.xhtml', body: '<html><nav>' },
        ),
      );
      if (navigationState === 'missing') {
        zip.remove('OEBPS/nav.xhtml');
      }

      const parsed = await parseEpubArchive(
        await zip.generateAsync({ type: 'nodebuffer' }),
      );

      expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
        'La llegada',
      ]);
      expect(textFrom(parsed.chapters).join('')).toBe(
        'La historia sigue intacta.',
      );
    },
  );

  it.each([
    [
      'META-INF/container.xml',
      '<container><rootfiles /></container>',
      'dónde está su catálogo',
    ],
    [
      'OEBPS/book.opf',
      '<package><manifest><item id="story" /></manifest></package>',
      'capítulos para importar',
    ],
    [
      'OEBPS/book.opf',
      '<package><manifest /><spine /></package>',
      'capítulos para importar',
    ],
    ['mimetype', 'application/zip', 'formato EPUB requerido'],
  ])(
    'rejects incomplete package metadata in %s without importing a partial book',
    async (entry, xml, message) => {
      const zip = await JSZip.loadAsync(
        await createEpub([{ id: 'story', body: '<p>Historia.</p>' }]),
      );
      zip.file(entry, xml);

      await expect(
        parseEpubArchive(await zip.generateAsync({ type: 'nodebuffer' })),
      ).rejects.toThrow(message);
    },
  );

  it('rejects a missing story document instead of silently importing an incomplete book', async () => {
    const zip = await JSZip.loadAsync(
      await createEpub([{ id: 'story', body: '<p>Historia.</p>' }]),
    );
    zip.remove('OEBPS/Text/story.xhtml');

    await expect(
      parseEpubArchive(await zip.generateAsync({ type: 'nodebuffer' })),
    ).rejects.toThrow('incompleto o dañado');
  });

  it('skips nonlinear, unsupported and unresolved spine entries without creating filler chapters', async () => {
    const zip = await JSZip.loadAsync(
      await createEpub([
        { id: 'story', body: '<h1>La historia</h1><p>Texto narrativo.</p>' },
        { id: 'supplement', body: '<p>Apéndice no lineal.</p>' },
        { id: 'attachment', body: '<p>Archivo adjunto.</p>' },
      ]),
    );
    const opf = await zip.file('OEBPS/book.opf')!.async('string');
    zip.file(
      'OEBPS/book.opf',
      opf
        .replace(
          '<itemref idref="supplement" />',
          '<itemref idref="supplement" linear="no" />',
        )
        .replace(
          'id="attachment" href="Text/attachment.xhtml" media-type="application/xhtml+xml"',
          'id="attachment" href="Text/attachment.xhtml" media-type="application/octet-stream"',
        )
        .replace('</spine>', '<itemref idref="missing" /></spine>'),
    );

    const parsed = await parseEpubArchive(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'La historia',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Texto narrativo.');
  });

  it('excludes a whole editorial body with an opaque filename and preserves the following narrative', async () => {
    const zip = await JSZip.loadAsync(
      await createEpub([
        { id: 'opaque', body: '<h1>Equipo editorial</h1><p>Gracias.</p>' },
        { id: 'story', body: '<h1>La historia</h1><p>Texto narrativo.</p>' },
      ]),
    );
    const editorial = await zip
      .file('OEBPS/Text/opaque.xhtml')!
      .async('string');
    zip.file(
      'OEBPS/Text/opaque.xhtml',
      editorial.replace(
        '<body>',
        '<body xmlns:epub="http://www.idpf.org/2007/ops" epub:type="acknowledgments">',
      ),
    );

    const parsed = await parseEpubArchive(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );

    expect(parsed.chapters).toHaveLength(1);
    expect(textFrom(parsed.chapters).join('')).toBe('Texto narrativo.');
  });

  it('preserves quotes, verbatim blocks, inline marks and numbered lists in narrative content', async () => {
    const parsed = await parseEpubArchive(
      await createEpub([
        {
          id: 'story',
          body: '<h1>La historia</h1><blockquote><p>Una cita.</p></blockquote><pre>línea uno\n  línea dos</pre><p><s>Tachado</s> y <code>literal</code>.</p><ol start="3"><li><p>Tercero.</p></li></ol>',
        },
      ]),
    );

    expect(textFrom(nodesOfType(parsed.chapters, 'blockquote')).join('')).toBe(
      'Una cita.',
    );
    expect(textFrom(nodesOfType(parsed.chapters, 'codeBlock')).join('')).toBe(
      'línea uno\n  línea dos',
    );
    expect(nodesOfType(parsed.chapters, 'text')).toEqual(
      expect.arrayContaining([
        { type: 'text', text: 'Tachado', marks: [{ type: 'strike' }] },
        { type: 'text', text: 'literal', marks: [{ type: 'code' }] },
      ]),
    );
    expect(nodesOfType(parsed.chapters, 'orderedList')[0]?.['attrs']).toEqual({
      start: 3,
    });
    expect(textFrom(nodesOfType(parsed.chapters, 'listItem')).join('')).toBe(
      'Tercero.',
    );
  });

  it('restores illustration layout and decorative dividers without treating divider SVGs as failed images', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<h1>La historia</h1><p>Antes.</p><p class="image--float-left"><img src="../Images/map.png" alt="Mapa" width="240" /></p><p class="image--float-right"><img src="../Images/map.png" alt="Plano" width="0" style="width:180.5px" /></p><p class="scene-divider" style="color: #123456"><img src="../Images/divider-stars-123456.svg" /></p><p>Después.</p>',
          },
        ],
        { 'OEBPS/Images/map.png': png },
      ),
    );

    expect(nodesOfType(parsed.chapters, 'image')).toHaveLength(2);
    expect(nodesOfType(parsed.chapters, 'image')[0]?.['attrs']).toEqual(
      expect.objectContaining({
        alt: 'Mapa',
        width: 240,
        textFlow: 'text-right',
      }),
    );
    expect(nodesOfType(parsed.chapters, 'image')[1]?.['attrs']).toEqual(
      expect.objectContaining({
        alt: 'Plano',
        width: 181,
        textFlow: 'text-left',
      }),
    );
    expect(nodesOfType(parsed.chapters, 'sceneDivider')).toEqual([
      { type: 'sceneDivider', attrs: { variant: 'stars', color: '#123456' } },
    ]);
    expect(parsed.skippedImages).toBe(0);
    expect(textFrom(parsed.chapters).join('')).toBe('Antes.Después.');
  });
});
