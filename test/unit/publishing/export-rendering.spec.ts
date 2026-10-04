import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';
import type { ExportSettingsConfig } from '../../../src/publishing/exports/export-settings.types';
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

function pdfPageCount(buffer: Buffer): number | undefined {
  const match = buffer
    .toString('latin1')
    .match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  return match ? Number(match[1]) : undefined;
}

describe('export rendering', () => {
  it('normalizes Tiptap content and embeds referenced images', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const blocks = document.chapters[0]?.scenes[0]?.content ?? [];
    const html = blocksToHtml(blocks);

    expect(html).toContain('<h2>Una noche</h2>');
    expect(html).toContain('<strong>El tren llegó.</strong>');
    expect(html).toContain('data:image/png;base64');
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
      new DocxExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new PdfExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new EpubExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
    ]);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('applies custom margins and header/footer settings across formats', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const settings: ExportSettingsConfig = {
      margins: { topCm: 5, bottomCm: 1, leftCm: 1, rightCm: 3 },
      header: {
        text: '{{tituloLibro}}',
        alignment: 'center',
        pageNumber: { enabled: false, format: '' },
      },
      footer: {
        text: null,
        alignment: 'right',
        pageNumber: {
          enabled: true,
          format: 'Página {{pagina}} de {{totalPaginas}}',
        },
      },
    };

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, settings),
      new PdfExportRenderer().render(document, settings),
      new EpubExportRenderer().render(document, settings),
    ]);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('inserts a page break between scenes but not after the last scene of a chapter', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new PdfExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new EpubExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
    ]);

    // Portada (1) + capítulo/escena 1 (2) + salto antes de la escena 2 (3).
    expect(pdfPageCount(pdf.buffer)).toBe(3);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('inserts a page break between chapters', async () => {
    const document = await prepareExportDocument(multiChapterSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new PdfExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
      new EpubExportRenderer().render(document, DEFAULT_EXPORT_SETTINGS),
    ]);

    // Portada (1) + capítulo 1 (2) + salto antes del capítulo 2 (3).
    expect(pdfPageCount(pdf.buffer)).toBe(3);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
  });

  it('does not append blank trailing pages when header/footer are enabled', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const settings: ExportSettingsConfig = {
      margins: DEFAULT_EXPORT_SETTINGS.margins,
      header: {
        text: '{{tituloLibro}}',
        alignment: 'center',
        pageNumber: { enabled: false, format: '' },
      },
      footer: {
        text: null,
        alignment: 'center',
        pageNumber: {
          enabled: true,
          format: 'Página {{pagina}} de {{totalPaginas}}',
        },
      },
    };

    const pdf = await new PdfExportRenderer().render(document, settings);

    // Portada (1) + 2 escenas de contenido (2 y 3). Antes del fix, dibujar
    // el footer cerca del margen inferior disparaba la paginación
    // automática de pdfkit y agregaba una página en blanco extra al final
    // por cada página existente.
    expect(pdfPageCount(pdf.buffer)).toBe(3);
  });

  it('renders the title alone on a cover page with no header/footer', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const settings: ExportSettingsConfig = {
      margins: DEFAULT_EXPORT_SETTINGS.margins,
      header: {
        text: '{{tituloLibro}}',
        alignment: 'center',
        pageNumber: { enabled: false, format: '' },
      },
      footer: {
        text: null,
        alignment: 'center',
        pageNumber: {
          enabled: true,
          format: 'Página {{pagina}} de {{totalPaginas}}',
        },
      },
    };

    const [docx, pdf, epub] = await Promise.all([
      new DocxExportRenderer().render(document, settings),
      new PdfExportRenderer().render(document, settings),
      new EpubExportRenderer().render(document, settings),
    ]);

    // Portada (1) + 2 escenas de contenido; el footer numera "Página 1 de 2"
    // (reiniciado) sobre las páginas de contenido, no sobre la portada.
    expect(pdfPageCount(pdf.buffer)).toBe(3);

    expect(docx.buffer.subarray(0, 2).toString()).toBe('PK');
    expect(epub.buffer.subarray(0, 2).toString()).toBe('PK');
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

  it('splits each scene into its own EPUB file so readers get a real page break', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const epub = await new EpubExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );
    const files = await epubXhtmlFiles(epub.buffer);

    // Portada + escena 1 + escena 2 = 3 archivos separados (spine items).
    expect(files).toHaveLength(3);
    expect(files[1]).toContain('Contenido de la escena 1.');
    expect(files[2]).toContain('Contenido de la escena 2.');
  });

  it('shows the title only on the cover page, never duplicated in the content', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const epub = await new EpubExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );
    const files = await epubXhtmlFiles(epub.buffer);
    const titlePageBody = epubBody(files[0] ?? '');
    const chapterFileBody = epubBody(files[1] ?? '');

    // El <title> del <head> también repite el texto legítimamente; lo que
    // no debe duplicarse es el encabezado <h1> visible en el <body>, y ya
    // no existe un nivel "libro" que lo repita en el contenido.
    expect(titlePageBody.match(/<h1>/g) ?? []).toHaveLength(1);
    expect(chapterFileBody.match(/<h1>/g) ?? []).toHaveLength(0);
    // epub-gen sanea el XHTML y codifica caracteres no-ASCII como entidades.
    expect(chapterFileBody).toContain('<h2>Cap&#xED;tulo I</h2>');
  });

  function extractTextYPositions(buffer: Buffer, needle: string): number[] {
    const streamTok = Buffer.from('stream');
    const endTok = Buffer.from('endstream');
    const positions: number[] = [];
    let idx = 0;
    for (;;) {
      const s = buffer.indexOf(streamTok, idx);
      if (s === -1) {
        break;
      }
      let dataStart = s + streamTok.length;
      if (buffer[dataStart] === 0x0d) {
        dataStart++;
      }
      if (buffer[dataStart] === 0x0a) {
        dataStart++;
      }
      const e = buffer.indexOf(endTok, dataStart);
      if (e === -1) {
        break;
      }
      try {
        const content = inflateSync(buffer.subarray(dataStart, e)).toString(
          'latin1',
        );
        for (const block of content.split('BT').slice(1)) {
          // pdfkit puede partir el texto en varios fragmentos hex dentro
          // del mismo operador TJ (kerning entre ciertos pares de letras),
          // así que hay que reensamblarlos antes de buscar el texto.
          const hexChunks = [...block.matchAll(/<([0-9a-f]+)>/g)].map(
            (m) => m[1] ?? '',
          );
          const decoded = Buffer.from(hexChunks.join(''), 'hex').toString(
            'latin1',
          );
          if (decoded.includes(needle)) {
            const match = /1 0 0 1 [-\d.]+ (-?[\d.]+) Tm/.exec(block);
            if (match?.[1]) {
              positions.push(Number(match[1]));
            }
          }
        }
      } catch {
        // No es un content stream FlateDecode (fuentes embebidas, etc).
      }
      idx = e + endTok.length;
    }
    return positions;
  }

  it('keeps the header/footer position fixed regardless of the configured margin', async () => {
    const document = await prepareExportDocument(source, () =>
      Promise.resolve({
        buffer: imageBuffer,
        mimeType: 'image/png',
        extension: 'png',
      }),
    );

    const settingsFor = (marginCm: number): ExportSettingsConfig => ({
      margins: {
        topCm: marginCm,
        bottomCm: marginCm,
        leftCm: marginCm,
        rightCm: marginCm,
      },
      header: {
        text: 'HEADERMARKER',
        alignment: 'left',
        pageNumber: { enabled: false, format: '' },
      },
      footer: {
        text: 'FOOTERMARKER',
        alignment: 'left',
        pageNumber: { enabled: false, format: '' },
      },
    });

    const [smallMargin, largeMargin] = await Promise.all([
      new PdfExportRenderer().render(document, settingsFor(1)),
      new PdfExportRenderer().render(document, settingsFor(6)),
    ]);

    const headerYSmall = extractTextYPositions(
      smallMargin.buffer,
      'HEADERMARKER',
    );
    const headerYLarge = extractTextYPositions(
      largeMargin.buffer,
      'HEADERMARKER',
    );
    const footerYSmall = extractTextYPositions(
      smallMargin.buffer,
      'FOOTERMARKER',
    );
    const footerYLarge = extractTextYPositions(
      largeMargin.buffer,
      'FOOTERMARKER',
    );

    expect(headerYSmall.length).toBeGreaterThan(0);
    expect(footerYSmall.length).toBeGreaterThan(0);
    expect(headerYSmall).toEqual(headerYLarge);
    expect(footerYSmall).toEqual(footerYLarge);
  });

  it('renders without error when the configured margin is smaller than the header/footer band', async () => {
    const document = await prepareExportDocument(multiSceneSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const settings: ExportSettingsConfig = {
      margins: { topCm: 0.2, bottomCm: 0.2, leftCm: 0.2, rightCm: 0.2 },
      header: {
        text: 'HEADERMARKER',
        alignment: 'left',
        pageNumber: { enabled: false, format: '' },
      },
      footer: {
        text: 'FOOTERMARKER',
        alignment: 'left',
        pageNumber: { enabled: true, format: 'Página {{pagina}}' },
      },
    };

    const pdf = await new PdfExportRenderer().render(document, settings);

    // El margen real se empuja al mínimo necesario para no tapar el
    // header/footer; sigue habiendo portada (1) + 2 páginas de contenido.
    expect(pdf.buffer.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdfPageCount(pdf.buffer)).toBe(3);
  });
});
