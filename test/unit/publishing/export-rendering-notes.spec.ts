import { inflateSync } from 'node:zlib';
import JSZip from 'jszip';
import { DocxExportRenderer } from '../../../src/publishing/exports/renderers/docx-export.renderer';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import { PdfExportRenderer } from '../../../src/publishing/exports/renderers/pdf-export.renderer';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';
import { prepareExportDocument } from '../../../src/publishing/exports/tiptap-export';

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred literal shape must stay structurally assignable to Prisma.JsonValue
function footnoteNode(
  id: string,
  noteType: 'FOOTNOTE' | 'ENDNOTE',
  text: string,
) {
  return {
    type: 'footnoteReference',
    attrs: { id, noteType },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred literal shape must stay structurally assignable to ExportSourceRecord['chapters'][number]
function chapterWithNotes(title: string, suffix: string) {
  return {
    title,
    scenes: [
      {
        id: `scene-${suffix}`,
        title: 'Escena con notas',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Texto con una nota al pie' },
                footnoteNode(
                  `fn-${suffix}`,
                  'FOOTNOTE',
                  `Cuerpo nota al pie ${suffix}.`,
                ),
                { type: 'text', text: ' y una nota al final' },
                footnoteNode(
                  `en-${suffix}`,
                  'ENDNOTE',
                  `Cuerpo nota al final ${suffix}.`,
                ),
                { type: 'text', text: '.' },
              ],
            },
          ],
        },
      },
    ],
  };
}

const twoChapterNoteSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    chapterWithNotes('Capítulo I', '1'),
    chapterWithNotes('Capítulo II', '2'),
  ],
};

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred literal shape must stay structurally assignable to ExportSourceRecord
function sceneWithFootnote(suffix: string) {
  return {
    id: `scene-${suffix}`,
    title: `Escena ${suffix}`,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Texto con nota ' },
            footnoteNode(
              `fn-${suffix}`,
              'FOOTNOTE',
              `Cuerpo nota página ${suffix}.`,
            ),
          ],
        },
      ],
    },
  };
}

// Dos escenas en el mismo capítulo: el renderer de PDF ya fuerza un salto de
// página entre escenas, lo que da un medio determinista (sin depender del
// desborde de contenido) para poner cada nota en una página física distinta.
const twoSceneFootnoteSource = {
  id: 'book-id',
  title: 'La obra',
  chapters: [
    {
      title: 'Capítulo I',
      scenes: [sceneWithFootnote('1'), sceneWithFootnote('2')],
    },
  ],
};

/**
 * Extracts the text drawn via TJ operators across all FlateDecode content
 * streams. pdfkit's embedded subset font shows text as hex-encoded byte
 * strings (`<...>`) whose bytes map 1:1 to the original latin1 characters;
 * concatenating them in order reconstructs the original text (kerning splits
 * fall mid-word, never introducing or removing a character).
 */
function extractPdfText(buffer: Buffer): string {
  const streamTok = Buffer.from('stream');
  const endTok = Buffer.from('endstream');
  const chunks: string[] = [];
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
      for (const match of content.matchAll(/<([0-9a-fA-F]+)>/g)) {
        chunks.push(Buffer.from(match[1] ?? '', 'hex').toString('latin1'));
      }
    } catch {
      // No es un content stream FlateDecode.
    }
    idx = e + endTok.length;
  }
  return chunks.join('');
}

function pdfPageCount(buffer: Buffer): number | undefined {
  const match = buffer
    .toString('latin1')
    .match(/\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/);
  return match ? Number(match[1]) : undefined;
}

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

describe('export rendering - footnotes and endnotes', () => {
  it('numbers footnotes and endnotes sequentially across the whole book, never resetting', async () => {
    const document = await prepareExportDocument(twoChapterNoteSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const chapter1Notes = document.chapters[0]?.scenes[0]?.notes ?? [];
    const chapter2Notes = document.chapters[1]?.scenes[0]?.notes ?? [];

    expect(chapter1Notes.map((n) => [n.id, n.noteType, n.number])).toEqual([
      ['fn-1', 'FOOTNOTE', 1],
      ['en-1', 'ENDNOTE', 2],
    ]);
    // Continúa sin reiniciar en el segundo capítulo: este número central es
    // el que usan ENDNOTE (en todos los formatos) y FOOTNOTE (solo en EPUB);
    // en PDF, FOOTNOTE usa en cambio un contador propio por página (ver test
    // "resets footnote numbering per physical page in PDF" más abajo).
    expect(chapter2Notes.map((n) => [n.id, n.noteType, n.number])).toEqual([
      ['fn-2', 'FOOTNOTE', 3],
      ['en-2', 'ENDNOTE', 4],
    ]);
  });

  it('embeds footnote and endnote bodies via native Word footnotes/endnotes', async () => {
    const document = await prepareExportDocument(twoChapterNoteSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const docx = await new DocxExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );
    const zip = await JSZip.loadAsync(docx.buffer);
    const documentXml = await zip.files['word/document.xml']?.async('string');
    const footnotesXml = await zip.files['word/footnotes.xml']?.async('string');
    const endnotesXml = await zip.files['word/endnotes.xml']?.async('string');

    expect(documentXml).toContain('w:footnoteReference');
    expect(documentXml).toContain('w:endnoteReference');
    expect(footnotesXml).toContain('Cuerpo nota al pie 1.');
    expect(footnotesXml).toContain('Cuerpo nota al pie 2.');
    expect(endnotesXml).toContain('Cuerpo nota al final 1.');
    expect(endnotesXml).toContain('Cuerpo nota al final 2.');

    // Word reinicia la numeración de notas al pie en cada hoja (inyectado
    // manualmente, la librería `docx` no lo expone). Las notas al final NO
    // llevan esta propiedad: su numeración continua es el default nativo.
    expect(documentXml).toMatch(
      /<w:footnotePr><w:numRestart w:val="eachPage"\/><\/w:footnotePr>/,
    );
    expect(documentXml?.match(/w:numRestart/g)).toHaveLength(1);
  });

  it('resets footnote numbering per physical page in PDF', async () => {
    const document = await prepareExportDocument(twoSceneFootnoteSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const pdf = await new PdfExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );

    expect(() => extractPdfText(pdf.buffer)).not.toThrow();
    const text = extractPdfText(pdf.buffer);
    // Cada escena cae en su propia página física (el renderer fuerza un
    // salto de página entre escenas), así que ambas notas al pie muestran
    // "1" como número — el contador se reinicia en la segunda página.
    // (El superíndice en sí — tamaño/baseline — no se puede verificar de
    // forma confiable con esta técnica de extracción de texto; se confirma
    // visualmente, no en este test.)
    expect(text).toContain('Cuerpo nota página 1.');
    expect(text).toContain('Cuerpo nota página 2.');
    expect(text).not.toContain('[1]');

    // Portada + escena 1 + escena 2 = 3 (sin notas al final en este fixture).
    expect(pdfPageCount(pdf.buffer)).toBe(3);
  });

  it('renders a single end-of-book Notas section for all endnotes in PDF', async () => {
    const document = await prepareExportDocument(twoChapterNoteSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const pdf = await new PdfExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );

    const text = extractPdfText(pdf.buffer);
    expect(text).toContain('Cuerpo nota al final 1.');
    expect(text).toContain('Cuerpo nota al final 2.');
    // Un solo encabezado "Notas" en todo el documento (no uno por capítulo).
    expect(text.match(/Notas/g)).toHaveLength(1);

    // Portada + capítulo 1 + capítulo 2 + Notas final = 4.
    expect(pdfPageCount(pdf.buffer)).toBe(4);
  });

  it('adds a single end-of-book Notas section with back-linked anchors in EPUB for both note types', async () => {
    const document = await prepareExportDocument(twoChapterNoteSource, () =>
      Promise.reject(new Error('no image expected')),
    );

    const epub = await new EpubExportRenderer().render(
      document,
      DEFAULT_EXPORT_SETTINGS,
    );
    const files = await epubXhtmlFiles(epub.buffer);

    const sceneFile = files.find((html) =>
      html.includes('Texto con una nota al pie'),
    );
    expect(sceneFile).toContain('epub:type="noteref"');
    expect(sceneFile).toContain('id="ref-fn-1"');
    expect(sceneFile).toContain('id="ref-en-1"');

    // Una sola sección "Notas" en todo el libro (no una por capítulo),
    // conteniendo las notas de ambos capítulos.
    const notesFiles = files.filter((html) => html.includes('class="note"'));
    expect(notesFiles).toHaveLength(1);
    const notesFile = notesFiles[0];
    expect(notesFile).toContain('id="note-fn-1"');
    expect(notesFile).toContain('id="note-en-1"');
    expect(notesFile).toContain('id="note-fn-2"');
    expect(notesFile).toContain('id="note-en-2"');
    expect(notesFile).toContain('Cuerpo nota al pie 1.');
    expect(notesFile).toContain('Cuerpo nota al final 1.');
    expect(notesFile).toContain('href="#ref-fn-1"');
    // Numeración continua de todo el libro (1, 2, 3, 4), compartida entre
    // ambos tipos — FOOTNOTE y ENDNOTE son indistinguibles en este formato.
    expect(notesFile).toContain('</a> 1.</p>');
    expect(notesFile).toContain('</a> 4.</p>');
  });
});
