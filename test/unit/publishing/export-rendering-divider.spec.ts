import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';
import { prepareExportDocument } from '../../../src/publishing/exports/tiptap-export';

function pdfContentStreams(buffer: Buffer): string {
  const streamToken = Buffer.from('stream');
  const endStreamToken = Buffer.from('endstream');
  const streams: string[] = [];
  let offset = 0;

  for (;;) {
    const start = buffer.indexOf(streamToken, offset);
    if (start === -1) {
      break;
    }
    let dataStart = start + streamToken.length;
    if (buffer[dataStart] === 0x0d) {
      dataStart++;
    }
    if (buffer[dataStart] === 0x0a) {
      dataStart++;
    }
    const end = buffer.indexOf(endStreamToken, dataStart);
    if (end === -1) {
      break;
    }
    try {
      streams.push(
        inflateSync(buffer.subarray(dataStart, end)).toString('latin1'),
      );
    } catch {
      // Ignore uncompressed or non-content streams.
    }
    offset = end + endStreamToken.length;
  }

  return streams.join('\n');
}

describe('export scene dividers', () => {
  it('keeps every divider variant distinct in the PDF renderer', async () => {
    const variants = [
      'flourish',
      'diamonds',
      'stars',
      'waves',
      'dots',
      'asterisks',
      'moon',
    ] as const;
    const dividerSource = {
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
                content: variants.map((variant) => ({
                  type: 'sceneDivider',
                  attrs: { variant },
                })),
              },
            },
          ],
        },
      ],
    };

    const document = await prepareExportDocument(dividerSource, () =>
      Promise.reject(new Error('no image expected')),
    );
    expect(document.chapters[0]?.scenes[0]?.content).toEqual(
      variants.map((variant) => ({ kind: 'sceneDivider', variant })),
    );

    const pdfContents = await Promise.all(
      variants.map(async (variant) => {
        const variantDocument = {
          ...document,
          chapters: [
            {
              ...document.chapters[0]!,
              scenes: [
                {
                  ...document.chapters[0]!.scenes[0]!,
                  content: [{ kind: 'sceneDivider' as const, variant }],
                },
              ],
            },
          ],
        };
        const rendered = await new PdfExportRenderer().render(
          variantDocument,
          DEFAULT_EXPORT_SETTINGS,
        );
        return pdfContentStreams(rendered.buffer);
      }),
    );

    expect(new Set(pdfContents).size).toBe(variants.length);
  });

  it('preserves the ornamental variant and embeds visual assets', async () => {
    const dividerSource = {
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
                  { type: 'sceneDivider', attrs: { variant: 'stars' } },
                ],
              },
            },
          ],
        },
      ],
    };

    const document = await prepareExportDocument(dividerSource, () =>
      Promise.reject(new Error('no image expected')),
    );
    expect(document.chapters[0]?.scenes[0]?.content).toEqual([
      { kind: 'sceneDivider', variant: 'stars' },
    ]);

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new PdfExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new EpubExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
    ]);

    const docxZip = await JSZip.loadAsync(docx.buffer);
    expect(
      Object.keys(docxZip.files).some((name) => name.endsWith('.svg')),
    ).toBe(true);
    expect(
      Object.keys(docxZip.files).some((name) => name.endsWith('.png')),
    ).toBe(true);

    const epubZip = await JSZip.loadAsync(epub.buffer);
    expect(
      Object.keys(epubZip.files).some((name) => name.endsWith('.svg')),
    ).toBe(true);
    expect(
      Object.keys(epubZip.files).some((name) => name.endsWith('.xhtml')),
    ).toBe(true);
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('renders a scene divider as a horizontal line, not a Unicode glyph', async () => {
    const dividerSource = {
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
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Antes.' }],
                  },
                  { type: 'horizontalRule' },
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'Después.' }],
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const document = await prepareExportDocument(dividerSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new PdfExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new EpubExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
    ]);

    // DOCX: el separador es un borde de párrafo (w:pBdr), no un carácter.
    const docxZip = await JSZip.loadAsync(docx.buffer);
    const documentXml =
      await docxZip.files['word/document.xml']?.async('string');
    expect(documentXml).toContain('w:pBdr');
    expect(documentXml).not.toContain('⁂');

    // PDF: una línea vectorial real (operadores m/l/S), no el glifo roto.
    const pdfText = pdf.buffer.toString('latin1');
    expect(pdfText).not.toContain('⁂');
    const streamTok = Buffer.from('stream');
    const endTok = Buffer.from('endstream');
    let idx = 0;
    let foundStrokedLine = false;
    for (;;) {
      const start = pdf.buffer.indexOf(streamTok, idx);
      if (start === -1) {
        break;
      }
      let dataStart = start + streamTok.length;
      if (pdf.buffer[dataStart] === 0x0d) {
        dataStart++;
      }
      if (pdf.buffer[dataStart] === 0x0a) {
        dataStart++;
      }
      const end = pdf.buffer.indexOf(endTok, dataStart);
      if (end === -1) {
        break;
      }
      try {
        const content = inflateSync(
          pdf.buffer.subarray(dataStart, end),
        ).toString('latin1');
        if (/ m\n[\d.]+ [\d.]+ l\n/.test(content) && /\nS\n/.test(content)) {
          foundStrokedLine = true;
        }
      } catch {
        // No es un content stream FlateDecode.
      }
      idx = end + endTok.length;
    }
    expect(foundStrokedLine).toBe(true);

    // EPUB: sin cambios, sigue siendo <hr/>.
    const epubZip = await JSZip.loadAsync(epub.buffer);
    const xhtmlFiles = Object.keys(epubZip.files).filter(
      (name) =>
        name.endsWith('.xhtml') && name.split('/').pop() !== 'toc.xhtml',
    );
    const epubPages = await Promise.all(
      xhtmlFiles.map((name) => epubZip.files[name]!.async('string')),
    );
    expect(epubPages.some((html) => html.includes('<hr'))).toBe(true);
  });
});
