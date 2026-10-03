import { inflateRawSync } from 'node:zlib';
import { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';
import {
  blocksToHtml,
  prepareExportDocument,
} from '../../../src/publishing/exports/tiptap-export';
import {
  SCENE_DIVIDER_VARIANTS,
  normalizeSceneDividerVariant,
  sceneDividerSvg,
} from '../../../src/publishing/exports/scene-divider';
import { normalizeExportIndentation } from '../../../src/publishing/exports/export-indentation';

const imageBuffer = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

function zipEntry(buffer: Buffer, entryName: string): Buffer {
  for (let offset = buffer.length - 46; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      continue;
    }

    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer
      .subarray(offset + 46, offset + 46 + nameLength)
      .toString('utf8');
    if (name !== entryName) {
      offset -= 45 + nameLength + extraLength + commentLength;
      continue;
    }

    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const contentStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(
      contentStart,
      contentStart + compressedSize,
    );

    if (compression === 0) {
      return compressed;
    }
    if (compression === 8) {
      return inflateRawSync(compressed);
    }
    throw new Error(`Unsupported ZIP compression: ${compression}`);
  }

  throw new Error(`ZIP entry not found: ${entryName}`);
}

function zipEntryText(buffer: Buffer, entryName: string): string {
  return zipEntry(buffer, entryName).toString('utf8');
}

const source = {
  id: 'project-id',
  title: 'La obra',
  books: [
    {
      id: 'book-id',
      title: 'Libro I',
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
                    type: 'sceneDivider',
                    attrs: { variant: 'stars' },
                  },
                  { type: 'horizontalRule' },
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
            {
              id: 'scene-untitled-id',
              title: null,
              content: null,
            },
            {
              id: 'scene-duplicate-title-id',
              title: 'La llegada',
              content: null,
            },
          ],
        },
        {
          id: 'chapter-ii-id',
          title: 'CapÃ­tulo II',
          scenes: [
            {
              id: 'scene-ii-id',
              title: 'La partida',
              content: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'ContinÃºo.' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
};

describe('export rendering', () => {
  it('normalizes Tiptap content and embeds referenced images', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const blocks = document.books[0]?.chapters[0]?.scenes[0]?.content ?? [];
    const html = blocksToHtml(blocks);

    expect(html).toContain('<h2>Una noche</h2>');
    expect(html).toContain('class="scene-divider"');
    expect(html).toContain('data:image/svg+xml;base64');
    expect(html).toContain('<hr />');
    expect(blocks).toEqual(
      expect.arrayContaining([
        { kind: 'sceneDivider', variant: 'stars' },
        { kind: 'horizontalRule' },
      ]),
    );
    expect(html).toContain('<strong>El tren llegó.</strong>');
    expect(html).toContain('data:image/png;base64');
    expect(document.toc).toEqual(
      expect.arrayContaining([
        {
          id: 'project-id',
          kind: 'project',
          title: 'La obra',
          level: 0,
          anchor: 'export_project_project_id',
        },
        {
          id: 'book-id',
          kind: 'book',
          title: 'Libro I',
          level: 1,
          anchor: 'export_book_book_id',
        },
        {
          id: 'chapter-id',
          kind: 'chapter',
          title: 'Capítulo I',
          level: 2,
          anchor: 'export_chapter_chapter_id',
        },
        {
          id: 'scene-id',
          kind: 'scene',
          title: 'La llegada',
          level: 3,
          anchor: 'export_scene_scene_id',
        },
        {
          id: 'chapter-ii-id',
          kind: 'chapter',
          title: 'CapÃ­tulo II',
          level: 2,
          anchor: 'export_chapter_chapter_ii_id',
        },
        {
          id: 'scene-ii-id',
          kind: 'scene',
          title: 'La partida',
          level: 3,
          anchor: 'export_scene_scene_ii_id',
        },
        {
          id: 'scene-duplicate-title-id',
          kind: 'scene',
          title: 'La llegada',
          level: 3,
          anchor: 'export_scene_scene_duplicate_title_id',
        },
      ]),
    );
  });

  it('generates a DOCX, PDF and EPUB buffer', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document),
      new PdfExportRenderer().render(document),
      new EpubExportRenderer().render(document),
    ]);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');

    const docxXml = zipEntryText(docx.buffer, 'word/document.xml');
    expect(docxXml).toContain('Índice');
    expect(docxXml).toContain('w:bookmarkStart');
    expect(docxXml).toContain('export_book_book_id');
    expect(docxXml.match(/w:type="page"/g)?.length).toBe(2);
    expect(docx.buffer.toString('latin1')).toContain('.svg');
    expect(docx.buffer.toString('latin1')).toContain('.png');

    const pdfText = pdf.buffer.toString('latin1');
    expect(pdfText).toContain('export_book_book_id');
    expect(pdfText).not.toContain('⁂');
    expect(pdfText.match(/\/Type\s*\/Page\b/g)?.length).toBe(3);

    const epubIndex = zipEntryText(epub.buffer, 'OEBPS/index.xhtml');
    const epubBook = zipEntryText(epub.buffer, 'OEBPS/book-0-chapter-0.xhtml');
    const epubSecondChapter = zipEntryText(
      epub.buffer,
      'OEBPS/book-0-chapter-1.xhtml',
    );
    expect(epubIndex).toContain('&#xCD;ndice');
    expect(epubIndex).toContain('book-0-chapter-0.xhtml#export_book_book_id');
    expect(epubBook).toContain('id="export_book_book_id"');
    expect(epubBook).toMatch(/images\/[^"']+\.svg/);
    expect(epubSecondChapter).toContain('id="export_chapter_chapter_ii_id"');
  });

  it('normalizes divider variants and preserves the four vector artworks', async () => {
    expect(normalizeSceneDividerVariant(undefined)).toBe('flourish');
    expect(normalizeSceneDividerVariant('unknown')).toBe('flourish');
    expect(SCENE_DIVIDER_VARIANTS).toEqual([
      'flourish',
      'diamonds',
      'stars',
      'waves',
    ]);

    for (const variant of SCENE_DIVIDER_VARIANTS) {
      expect(sceneDividerSvg(variant)).toContain('viewBox="0 0 256 64"');
      expect(sceneDividerSvg(variant)).toContain('#5b3d6f');
    }

    const baseBook = source.books[0]!;
    const baseChapter = baseBook.chapters[0]!;
    const baseScene = baseChapter.scenes[0]!;

    const document = await prepareExportDocument(
      {
        ...source,
        books: [
          {
            ...baseBook,
            chapters: [
              {
                ...baseChapter,
                scenes: [
                  {
                    ...baseScene,
                    content: {
                      type: 'doc',
                      content: SCENE_DIVIDER_VARIANTS.map((variant) => ({
                        type: 'sceneDivider',
                        attrs: { variant },
                      })),
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      () =>
        Promise.resolve({
          buffer: imageBuffer,
          mimeType: 'image/png',
          extension: 'png',
        }),
    );

    expect(document.books[0]?.chapters[0]?.scenes[0]?.content).toEqual(
      SCENE_DIVIDER_VARIANTS.map((variant) => ({
        kind: 'sceneDivider',
        variant,
      })),
    );
  });

  it('keeps large paragraph indents within the exportable page width', async () => {
    expect(
      normalizeExportIndentation({
        indentLeft: 12,
        indentRight: 12,
        firstLineIndent: 12,
      }),
    ).toEqual({
      indentLeft: 12,
      indentRight: 3.5,
      firstLineIndent: 0,
    });

    const document = await prepareExportDocument(
      {
        id: 'indentation-project',
        title: 'Indentation',
        books: [
          {
            id: 'indentation-book',
            title: 'Book',
            chapters: [
              {
                id: 'indentation-chapter',
                title: 'Chapter',
                scenes: [
                  {
                    id: 'indentation-scene',
                    title: 'Scene',
                    content: {
                      type: 'doc',
                      content: [
                        {
                          type: 'paragraph',
                          attrs: {
                            indentLeft: 12,
                            indentRight: 12,
                            firstLineIndent: 12,
                          },
                          content: [
                            {
                              type: 'text',
                              text: 'A long paragraph with enough content to wrap safely inside the available export width.',
                            },
                          ],
                        },
                      ],
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      () =>
        Promise.resolve({
          buffer: imageBuffer,
          mimeType: 'image/png',
          extension: 'png',
        }),
    );

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document),
      new PdfExportRenderer().render(document),
      new EpubExportRenderer().render(document),
    ]);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(zipEntryText(docx.buffer, 'word/document.xml')).toContain(
      'w:left="6804"',
    );
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(zipEntryText(epub.buffer, 'OEBPS/book-0-chapter-0.xhtml')).toContain(
      'margin-left:12cm;margin-right:3.5cm',
    );
  });
});
