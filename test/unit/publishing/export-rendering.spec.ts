import { inflateRawSync } from 'node:zlib';
import { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';
import {
  blocksToHtml,
  prepareExportDocument,
} from '../../../src/publishing/exports/tiptap-export';

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
    expect(html).toContain('<strong>El tren llegó.</strong>');
    expect(html).toContain('data:image/png;base64');
    expect(document.toc).toEqual([
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
        id: 'scene-duplicate-title-id',
        kind: 'scene',
        title: 'La llegada',
        level: 3,
        anchor: 'export_scene_scene_duplicate_title_id',
      },
    ]);
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

    const pdfText = pdf.buffer.toString('latin1');
    expect(pdfText).toContain('export_book_book_id');

    const epubIndex = zipEntryText(epub.buffer, 'OEBPS/index.xhtml');
    const epubBook = zipEntryText(epub.buffer, 'OEBPS/book-0.xhtml');
    expect(epubIndex).toContain('&#xCD;ndice');
    expect(epubIndex).toContain('book-0.xhtml#export_book_book_id');
    expect(epubBook).toContain('id="export_book_book_id"');
  });
});
