import { parseEpubArchive } from './epub-import.parser';
import {
  createEpub,
  nodesOfType,
  textFrom,
} from '../../../test/fixtures/epub-import';

describe('EPUB navigation regressions', () => {
  it('does not turn an isolated year destination into a filler chapter', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          { id: 'year', body: '<p id="year">2024</p>' },
          { id: 'story', body: '<h1>La llegada</h1><p>Historia.</p>' },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: '<html><nav epub:type="toc"><a href="Text/year.xhtml#year">Fecha</a></nav></html>',
        },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'La llegada',
    ]);
    expect(textFrom(parsed.chapters)).toEqual(['Historia.']);
  });

  it('excludes all descendants of a TOC-labeled editorial container and resumes outside it', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<section id="credits"><p>Publication staff.</p><div><h2>Team</h2><p>Editorial names.</p></div><h1>More staff</h1><p>Additional names.</p></section><section><h2>The arrival</h2><p>The story begins.</p></section>',
          },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: '<html><nav epub:type="toc"><a href="Text/story.xhtml#credits">Credits</a></nav></html>',
        },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'The arrival',
    ]);
    expect(textFrom(parsed.chapters)).toEqual(['The story begins.']);
    expect(parsed.chapters[0]?.scenes).toHaveLength(1);
  });

  it('keeps excluding editorial text after a paragraph destination and a subheading', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<p id="credits">Credits</p><h2 id="contributors">Contributors</h2><p>Editorial names.</p><h1 id="chapter-one">Chapter 1</h1><p>The story begins.</p>',
          },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: '<html><nav epub:type="toc"><a href="Text/story.xhtml#credits">Credits</a><a href="Text/story.xhtml#contributors">Contributors</a><a href="Text/story.xhtml#chapter-one">Chapter 1</a></nav></html>',
        },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Chapter 1',
    ]);
    expect(textFrom(parsed.chapters)).toEqual(['The story begins.']);
  });

  it('uses the meaningful TOC title when a document repeats the book title before its narrative heading', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<h1>Libro de prueba</h1><h2>La llegada</h2><p>Una historia intacta.</p>',
          },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: '<html><nav epub:type="toc"><a href="Text/story.xhtml">El viaje comienza</a></nav></html>',
        },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'El viaje comienza',
    ]);
    expect(parsed.chapters[0]?.scenes.map((scene) => scene.title)).toEqual([
      'El viaje comienza',
    ]);
    expect(textFrom(parsed.chapters)).toEqual(['Una historia intacta.']);
  });

  it('preserves the sole book heading when the TOC labels the enclosing collection', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<h1>Libro de prueba</h1><p>Una historia intacta.</p>',
          },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: '<html><nav epub:type="toc"><a href="Text/story.xhtml">Colección de relatos</a></nav></html>',
        },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Libro de prueba',
    ]);
    expect(parsed.chapters[0]?.scenes[0]?.title).toBe('Libro de prueba');
    expect(textFrom(parsed.chapters)).toEqual(['Una historia intacta.']);
  });

  it.each(['p', 'section'])(
    'preserves a TOC destination on a removed year in a %s',
    async (tag) => {
      const target =
        tag === 'p'
          ? '<p id="second">2024</p>'
          : '<section id="second"><p>2024</p></section>';
      const parsed = await parseEpubArchive(
        await createEpub(
          [
            {
              id: 'story',
              body: `<p id="first">Primera historia.</p>${target}<p>Segunda historia.</p>`,
            },
          ],
          {},
          {
            href: 'nav.xhtml',
            body: '<html><nav epub:type="toc"><a href="Text/story.xhtml#first">Primero</a><a href="Text/story.xhtml#second">Segundo</a></nav></html>',
          },
        ),
      );

      expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
        'Primero',
        'Segundo',
      ]);
      expect(parsed.chapters.map((chapter) => textFrom(chapter))).toEqual([
        ['Primera historia.'],
        ['Segunda historia.'],
      ]);
      expect(
        parsed.chapters.map((chapter) => chapter.scenes[0]?.title),
      ).toEqual(['Primero', 'Segundo']);
    },
  );

  it('detects local extensionless images by their bytes while rejecting nonimages and remote sources', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parsed = await parseEpubArchive(
      await createEpub(
        [
          {
            id: 'story',
            body: '<h1>La historia</h1><p>Texto intacto.</p><img src="../Images/image001" /><img src="../Images/cover.image" /><img src="../Images/notimage" /><img src="https://example.com/image001" /><img src="//example.com/image001" />',
          },
        ],
        {
          'OEBPS/Images/image001': png,
          'OEBPS/Images/cover.image': png,
          'OEBPS/Images/notimage': 'plain text',
        },
      ),
    );

    expect([...parsed.images.values()]).toEqual([
      expect.objectContaining({
        buffer: png,
        contentType: 'image/png',
        extension: 'png',
      }),
      expect.objectContaining({
        buffer: png,
        contentType: 'image/png',
        extension: 'png',
      }),
    ]);
    expect(nodesOfType(parsed.chapters, 'image')).toHaveLength(2);
    expect(parsed.skippedImages).toBe(3);
    expect(textFrom(parsed.chapters)).toEqual(['Texto intacto.']);
  });

  it('falls back to narrative headings when the optional navigation href has an invalid escape', async () => {
    const parsed = await parseEpubArchive(
      await createEpub(
        [{ id: 'story', body: '<h1>La llegada</h1><p>La historia sigue.</p>' }],
        {},
        { href: 'nav%ZZ.xhtml', body: '<html />' },
      ),
    );

    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'La llegada',
    ]);
    expect(textFrom(parsed.chapters)).toEqual(['La historia sigue.']);
  });
});
