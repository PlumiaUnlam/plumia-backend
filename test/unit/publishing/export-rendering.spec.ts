import type { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import type { ExportImage } from '../../../src/publishing/exports/export.types';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import {
  blocksToHtml,
  prepareExportDocument,
} from '../../../src/publishing/exports/tiptap-export';

const imageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const source = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-id',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'scene-id',
          title: 'La llegada',
          content: {
            type: 'doc',
            content: [
              {
                type: 'heading',
                attrs: { level: 2 },
                content: [{ type: 'text', text: 'Una noche' }],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'El tren llegó.',
                    marks: [{ type: 'bold' }],
                  },
                ],
              },
              {
                type: 'image',
                attrs: {
                  storageKey: 'scenes/scene/image.png',
                  alt: 'Estación',
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

const multiSceneSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-1',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'scene-1',
          title: 'Escena 1',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido de la escena 1.' }],
              },
            ],
          },
        },
        {
          id: 'scene-2',
          title: 'Escena 2',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido de la escena 2.' }],
              },
            ],
          },
        },
      ],
    },
  ],
};

const multiChapterSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      id: 'chapter-1',
      title: 'Capítulo I',
      scenes: [
        {
          id: 'chapter1-scene',
          title: 'Escena única',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido del capítulo 1.' }],
              },
            ],
          },
        },
      ],
    },
    {
      id: 'chapter-2',
      title: 'Capítulo II',
      scenes: [
        {
          id: 'chapter2-scene',
          title: 'Escena única',
          content: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Contenido del capítulo 2.' }],
              },
            ],
          },
        },
      ],
    },
  ],
};

const pngImage = (): Promise<ExportImage> =>
  Promise.resolve({
    buffer: imageBuffer,
    mimeType: 'image/png',
    extension: 'png',
  });

async function epubXhtmlFiles(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files)
    .filter(
      (name) =>
        name.endsWith('.xhtml') && name.split('/').pop() !== 'toc.xhtml',
    )
    .sort();
  return Promise.all(entries.map((name) => zip.files[name]!.async('string')));
}

function epubBody(html: string): string {
  return html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? html;
}

describe('export rendering', () => {
  it('normalizes Tiptap content and embeds referenced images', async () => {
    const document = await prepareExportDocument(source, pngImage);

    const blocks = document.chapters[0]?.scenes[0]?.content ?? [];
    const html = blocksToHtml(blocks);

    expect(html).toContain('<h2>Una noche</h2>');
    expect(html).toContain('<strong>El tren llegó.</strong>');
    expect(html).toContain('data:image/png;base64');
  });

  it('generates a valid EPUB container with an uncompressed mimetype first', async () => {
    const document = await prepareExportDocument(source, pngImage);

    const epub = await new EpubExportRenderer().render(document);

    expect(epub.contentType).toBe('application/epub+zip');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
    // Local file header: el nombre arranca en el byte 30 y el método de
    // compresión (0 = STORE) está en el byte 8.
    expect(epub.buffer.readUInt16LE(8)).toBe(0);
    expect(epub.buffer.subarray(30, 38).toString()).toBe('mimetype');
    expect(epub.buffer.subarray(38, 58).toString()).toBe(
      'application/epub+zip',
    );

    const zip = await JSZip.loadAsync(epub.buffer);
    expect(zip.files['META-INF/container.xml']).toBeDefined();
    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    expect(opf).toContain('<dc:identifier id="book-id">urn:uuid:book-id');
    expect(opf).toContain('properties="nav"');
    expect(opf).toMatch(
      /<meta property="dcterms:modified">\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/meta>/,
    );
  });

  it('embeds referenced images in the EPUB and declares them in the manifest', async () => {
    const document = await prepareExportDocument(source, pngImage);

    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    const image =
      await zip.files['OEBPS/images/image-0.png']!.async('nodebuffer');
    expect(image.equals(imageBuffer)).toBe(true);

    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    expect(opf).toContain('href="images/image-0.png" media-type="image/png"');

    const scene =
      await zip.files['OEBPS/book-0-chapter-0-scene-0.xhtml']!.async('string');
    expect(scene).toContain('<img src="images/image-0.png" alt="Estación" />');
  });

  it('includes a linked hierarchical index', async () => {
    const document = await prepareExportDocument(source, pngImage);

    const epub = await new EpubExportRenderer().render(document);

    const epubZip = await JSZip.loadAsync(epub.buffer);
    const index = await epubZip.files['OEBPS/index.xhtml']!.async('string');
    expect(index).toContain('Índice');
    expect(index).toContain('cover.xhtml#export_book_book_id');
    expect(index).toContain(
      'book-0-chapter-0-scene-0.xhtml#export_scene_scene_id',
    );
  });

  it('splits each scene into its own EPUB file so readers get a real page break', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const epub = await new EpubExportRenderer().render(document);
    const files = await epubXhtmlFiles(epub.buffer);

    // Portada + índice + escena 1 + escena 2 = 4 archivos (spine items).
    expect(files).toHaveLength(4);
    expect(
      files.some((file) => file.includes('Contenido de la escena 1.')),
    ).toBe(true);
    expect(
      files.some((file) => file.includes('Contenido de la escena 2.')),
    ).toBe(true);
  });

  it('starts each chapter in its own EPUB file', async () => {
    const document = await prepareExportDocument(multiChapterSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    const first =
      await zip.files['OEBPS/book-0-chapter-0-scene-0.xhtml']!.async('string');
    const second =
      await zip.files['OEBPS/book-0-chapter-1-scene-0.xhtml']!.async('string');
    expect(first).toContain('Contenido del capítulo 1.');
    expect(second).toContain('Contenido del capítulo 2.');

    const nav = await zip.files['OEBPS/toc.xhtml']!.async('string');
    expect(nav).toContain('Capítulo I');
    expect(nav).toContain('Capítulo II');
  });

  it('shows the title only on the cover page, never duplicated in the content', async () => {
    const document = await prepareExportDocument(source, pngImage);

    const epub = await new EpubExportRenderer().render(document);
    const files = await epubXhtmlFiles(epub.buffer);
    const titlePageBody = epubBody(
      files.find((file) => file.includes('id="export_book_book_id"')) ?? '',
    );
    const chapterFileBody = epubBody(
      files.find((file) => file.includes('id="export_chapter_chapter_id"')) ??
        '',
    );

    // El <title> del <head> también repite el texto legítimamente; lo que
    // no debe duplicarse es el encabezado <h1> visible en el <body>.
    expect(titlePageBody.match(/<h1\b[^>]*>/g) ?? []).toHaveLength(1);
    expect(chapterFileBody.match(/<h1\b[^>]*>/g) ?? []).toHaveLength(0);
    expect(chapterFileBody).toContain(
      '<h2 id="export_chapter_chapter_id">Capítulo I</h2>',
    );
  });
});

describe('export notes', () => {
  const note = (
    kind: 'footnote' | 'endnote',
    text: string,
    marks: Array<Prisma.JsonObject> = [],
  ): Prisma.JsonObject => ({
    type: 'noteReference',
    attrs: {
      id: `${kind}-${text}`,
      kind,
      content: [{ type: 'text', text, marks }],
    },
  });

  const paragraph = (
    ...content: Array<Prisma.JsonObject>
  ): Prisma.JsonObject => ({ type: 'paragraph', content });

  const text = (value: string): Prisma.JsonObject => ({
    type: 'text',
    text: value,
  });

  const notesSource = {
    id: 'book-id',
    title: 'La obra',
    chapters: [
      {
        id: 'chapter-1',
        title: 'Capítulo I',
        scenes: [
          {
            id: 'scene-1',
            title: null,
            content: {
              type: 'doc',
              content: [
                paragraph(
                  text('Uno'),
                  note('footnote', 'Pie A', [{ type: 'italic' }]),
                  text(' dos'),
                  note('endnote', 'Final A'),
                ),
              ],
            },
          },
          {
            id: 'scene-2',
            title: null,
            content: {
              type: 'doc',
              content: [paragraph(text('Tres'), note('footnote', 'Pie B'))],
            },
          },
        ],
      },
      {
        id: 'chapter-2',
        title: 'Capítulo II',
        scenes: [
          {
            id: 'scene-3',
            title: null,
            content: {
              type: 'doc',
              content: [
                paragraph(
                  text('Cuatro'),
                  note('footnote', 'Pie C', [
                    { type: 'link', attrs: { href: 'https://a.com/?x=1&y=2' } },
                  ]),
                  note('endnote', 'Final B'),
                  note('footnote', '   '),
                ),
              ],
            },
          },
        ],
      },
    ],
  };

  async function renderNotes(): Promise<JSZip> {
    const document = await prepareExportDocument(notesSource, () =>
      Promise.reject(new Error('no image expected')),
    );
    const epub = await new EpubExportRenderer().render(document);
    return JSZip.loadAsync(epub.buffer);
  }

  const read = (zip: JSZip, name: string): Promise<string> =>
    zip.files[`OEBPS/${name}`]!.async('string');

  it('parses note references with their kind and formatted text, dropping empty notes', async () => {
    const document = await prepareExportDocument(notesSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const first = document.chapters[0]?.scenes[0]?.content[0];
    expect(first).toMatchObject({
      kind: 'paragraph',
      inlines: [
        { kind: 'text', text: 'Uno' },
        {
          kind: 'note',
          noteKind: 'footnote',
          inlines: [{ kind: 'text', text: 'Pie A', italic: true }],
        },
        { kind: 'text', text: ' dos' },
        { kind: 'note', noteKind: 'endnote' },
      ],
    });

    const last = document.chapters[1]?.scenes[0]?.content[0];
    expect(
      last?.kind === 'paragraph'
        ? last.inlines.filter((inline) => inline.kind === 'note')
        : [],
    ).toHaveLength(2);
  });

  it('numbers footnotes per chapter and places them at the end of their scene', async () => {
    const zip = await renderNotes();
    const scene1 = await read(zip, 'book-0-chapter-0-scene-0.xhtml');
    const scene2 = await read(zip, 'book-0-chapter-0-scene-1.xhtml');
    const scene3 = await read(zip, 'book-0-chapter-1-scene-0.xhtml');

    expect(scene1).toContain(
      '<a epub:type="noteref" class="noteref" id="fn-c0-1-ref" href="#fn-c0-1"><sup>1</sup></a>',
    );
    expect(scene1).toContain(
      '<aside epub:type="footnote" class="footnote" id="fn-c0-1"><p><a href="#fn-c0-1-ref">1</a>. <em>Pie A</em></p></aside>',
    );
    // El texto queda en el archivo (lo usa el popup) pero oculto en la página.
    expect(await read(zip, 'style.css')).toContain(
      'aside.footnote { display: none; }',
    );
    expect(scene2).toContain('id="fn-c0-2"');
    expect(scene2).toContain('Pie B');
    expect(scene2).not.toContain('Pie A');
    // Reinicia en el capítulo II.
    expect(scene3).toContain('href="#fn-c1-1"><sup>1</sup></a>');
    expect(scene3).toContain('<a href="https://a.com/?x=1&amp;y=2">Pie C</a>');
  });

  it('numbers endnotes across the book and lists them in notes.xhtml grouped by chapter', async () => {
    const zip = await renderNotes();
    const scene1 = await read(zip, 'book-0-chapter-0-scene-0.xhtml');
    const scene3 = await read(zip, 'book-0-chapter-1-scene-0.xhtml');
    const notes = await read(zip, 'notes.xhtml');

    expect(scene1).toContain(
      'id="enref-1" href="notes.xhtml#en-1"><sup>1</sup></a>',
    );
    expect(scene3).toContain(
      'id="enref-2" href="notes.xhtml#en-2"><sup>2</sup></a>',
    );
    expect(notes).toContain('<section epub:type="endnotes">');
    expect(notes.indexOf('Capítulo I<')).toBeLessThan(
      notes.indexOf('Capítulo II<'),
    );
    expect(notes).toContain('<li epub:type="endnote" id="en-1" value="1">');
    expect(notes).toContain(
      'href="book-0-chapter-1-scene-0.xhtml#enref-2">↩</a>',
    );

    const opf = await read(zip, 'content.opf');
    expect(opf).toContain('<itemref idref="notes"/>');
    expect(opf.lastIndexOf('<itemref')).toBe(
      opf.indexOf('<itemref idref="notes"/>'),
    );
    expect(await read(zip, 'toc.xhtml')).toContain('href="notes.xhtml"');
    expect(await read(zip, 'index.xhtml')).toContain(
      '<a href="notes.xhtml">Notas</a>',
    );
  });

  it('does not generate a notes section when the book has no endnotes', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );
    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    expect(zip.files['OEBPS/notes.xhtml']).toBeUndefined();
    expect(await read(zip, 'index.xhtml')).not.toContain('Notas');
  });
});

describe('export cover and author', () => {
  async function render(cover: ExportImage | null): Promise<JSZip> {
    const document = await prepareExportDocument(
      multiSceneSource,
      () => Promise.reject(new Error('no image expected')),
      { author: 'Ana & Pérez', cover },
    );
    const epub = await new EpubExportRenderer().render(document);
    return JSZip.loadAsync(epub.buffer);
  }

  it('embeds the cover image as the first spine item and declares it as cover-image', async () => {
    const zip = await render({
      buffer: imageBuffer,
      mimeType: 'image/png',
      extension: 'png',
    });

    const coverFile = zip.files['OEBPS/images/cover.png']!;
    expect((await coverFile.async('nodebuffer')).equals(imageBuffer)).toBe(
      true,
    );

    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    expect(opf).toContain(
      '<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>',
    );
    expect(opf).toContain('<meta name="cover" content="cover-image"/>');
    expect(opf.match(/<itemref idref="([^"]+)"/)?.[1]).toBe('cover-page');

    const coverPage =
      await zip.files['OEBPS/cover-image.xhtml']!.async('string');
    expect(coverPage).toContain('epub:type="cover"');
    expect(coverPage).toContain('src="images/cover.png"');

    const nav = await zip.files['OEBPS/toc.xhtml']!.async('string');
    expect(nav).not.toContain('cover-image.xhtml');
  });

  it('keeps the current title page when there is no cover', async () => {
    const zip = await render(null);

    expect(zip.files['OEBPS/cover-image.xhtml']).toBeUndefined();
    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    expect(opf).not.toContain('cover-image');
    expect(opf.match(/<itemref idref="([^"]+)"/)?.[1]).toBe('cover');
  });

  it('uses the author in the metadata and on the title page', async () => {
    const zip = await render(null);

    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    expect(opf).toContain('<dc:creator>Ana &amp; Pérez</dc:creator>');
    expect(opf).toContain('<dc:publisher>PlumIA</dc:publisher>');
    const titlePage = await zip.files['OEBPS/cover.xhtml']!.async('string');
    expect(titlePage).toContain('<p class="author">Ana &amp; Pérez</p>');
  });
});
