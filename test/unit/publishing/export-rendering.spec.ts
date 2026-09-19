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

const source = {
  id: 'project-id',
  title: 'La obra',
  books: [
    {
      title: 'Libro I',
      chapters: [
        {
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
    },
  ],
};

describe('export rendering', () => {
  it('normalizes Tiptap content and embeds referenced images', async () => {
    const document = await prepareExportDocument(source, async () => ({
      buffer: imageBuffer,
      mimeType: 'image/png',
      extension: 'png',
    }));

    const blocks = document.books[0]?.chapters[0]?.scenes[0]?.content ?? [];
    const html = blocksToHtml(blocks);

    expect(html).toContain('<h2>Una noche</h2>');
    expect(html).toContain('<strong>El tren llegó.</strong>');
    expect(html).toContain('data:image/png;base64');
  });

  it('generates a DOCX, PDF and EPUB buffer', async () => {
    const document = await prepareExportDocument(source, async () => ({
      buffer: imageBuffer,
      mimeType: 'image/png',
      extension: 'png',
    }));

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document),
      new PdfExportRenderer().render(document),
      new EpubExportRenderer().render(document),
    ]);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
  });
});
