import JSZip from 'jszip';
import { parseEpubArchive } from './epub-import.parser';

async function createEpub(
  documents: Array<{ id: string; body: string }>,
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
  zip.file(
    'OEBPS/book.opf',
    `<package><metadata><title>Libro de prueba</title></metadata><manifest>${manifest}</manifest><spine>${spine}</spine></package>`,
  );
  for (const { id, body } of documents) {
    zip.file(
      `OEBPS/Text/${id}.xhtml`,
      `<html><head><title>Libro de prueba</title></head><body>${body}</body></html>`,
    );
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
});
