import JSZip from 'jszip';
import { parseEpubArchive } from './epub-import.parser';
import {
  createEpub,
  textFrom,
  nodesOfType,
} from '../../../test/fixtures/epub-import';

describe('parseEpubArchive', () => {
  it('resumes unnumbered narrative chapters after a promotional insert', async () => {
    const epub = await createEpub(
      [
        { id: 'first', body: '<h1>Capítulo 1</h1><p>Uno.</p>' },
        { id: 'promo', body: '<p>Promoción.</p>' },
        { id: 'second', body: '<h1>El regreso</h1><p>Dos.</p>' },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><a href="Text/first.xhtml">Capítulo 1</a><a href="Text/promo.xhtml">Preview</a><a href="Text/second.xhtml">El regreso</a></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Capítulo 1',
      'El regreso',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Uno.Dos.');
  });

  it('bounds nested EPUB 2 NCX samples without losing subsequent main chapters', async () => {
    const buffer = await createEpub(
      [
        { id: 'first', body: '<h1>Capítulo 1</h1><p>Uno.</p>' },
        { id: 'promo', body: '<p>Promoción.</p>' },
        { id: 'sample', body: '<h1>Capítulo 1</h1><p>Adelanto.</p>' },
        { id: 'second', body: '<h1>Capítulo 2</h1><p>Dos.</p>' },
      ],
      {},
      {
        href: 'toc.ncx',
        body: '<ncx><navMap><navPoint><navLabel><text>Capítulo 1</text></navLabel><content src="Text/first.xhtml" /></navPoint><navPoint><navLabel><text>Preview</text></navLabel><content src="Text/promo.xhtml" /><navPoint><navLabel><text>Capítulo 1 de otra obra</text></navLabel><content src="Text/sample.xhtml" /></navPoint></navPoint><navPoint><navLabel><text>Capítulo 2</text></navLabel><content src="Text/second.xhtml" /></navPoint></navMap></ncx>',
      },
    );
    const zip = await JSZip.loadAsync(buffer);
    const opf = await zip.file('OEBPS/book.opf')!.async('string');
    zip.file(
      'OEBPS/book.opf',
      opf.replace(
        'media-type="application/xhtml+xml" properties="nav"',
        'media-type="application/x-dtbncx+xml"',
      ),
    );
    const parsed = await parseEpubArchive(
      await zip.generateAsync({ type: 'nodebuffer' }),
    );
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Capítulo 1',
      'Capítulo 2',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Uno.Dos.');
  });

  it('transfers empty anchor IDs to visible content without generating introduction chapters', async () => {
    const epub = await createEpub(
      [
        {
          id: 'story',
          body: '<p id="chapter-one"> </p><h1>Capítulo 1</h1><p>Uno.</p><p id="chapter-two"> </p><h1>Capítulo 2</h1><p>Dos.</p>',
        },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><a href="Text/story.xhtml#chapter-one">Capítulo 1</a><a href="Text/story.xhtml#chapter-two">Capítulo 2</a></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Capítulo 1',
      'Capítulo 2',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Uno.Dos.');
  });

  it('ignores only invalid TOC fragments and keeps valid chapter destinations', async () => {
    const epub = await createEpub(
      [
        {
          id: 'story',
          body: '<section id="one"><p>Uno.</p></section><section id="two"><p>Dos.</p></section>',
        },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><a href="Text/story.xhtml#one">Primero</a><a href="Text/story.xhtml#bad%ZZ">Inválido</a><a href="Text/story.xhtml#two">Segundo</a></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Primero',
      'Segundo',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Uno.Dos.');
  });

  it('retains explicit TOC boundaries instead of consuming the next heading as a subtitle', async () => {
    const epub = await createEpub(
      [
        {
          id: 'story',
          body: '<h1 id="part">Parte I</h1><h2 id="chapter">El comienzo</h2><p>Historia.</p>',
        },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><a href="Text/story.xhtml#part">Parte I</a><a href="Text/story.xhtml#chapter">El comienzo</a></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'El comienzo',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Historia.');
  });

  it('selects a retained title and excludes editorial descendants inside quotes and lists', async () => {
    const epub = await createEpub([
      {
        id: 'story',
        body: '<section xmlns:epub="http://www.idpf.org/2007/ops" epub:type="acknowledgments"><h1>Título descartado</h1><p>Gracias.</p></section><p>El comienzo</p><blockquote><p>Texto citado.</p><section xmlns:epub="http://www.idpf.org/2007/ops" epub:type="acknowledgments"><p>Créditos ocultos.</p></section></blockquote><ul><li><p>Elemento válido.</p><span xmlns:epub="http://www.idpf.org/2007/ops" epub:type="copyright-page">Editorial.</span></li></ul>',
      },
    ]);
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters[0]?.title).toBe('El comienzo');
    expect(textFrom(parsed.chapters).join('')).toBe(
      'El comienzoTexto citado.Elemento válido.',
    );
  });

  it('retains the outer editorial heading level across nested editorial subheadings', async () => {
    const epub = await createEpub([
      {
        id: 'story',
        body: '<h1>Agradecimientos</h1><h3>Créditos</h3><p>Editorial uno.</p><h2>Equipo</h2><p>Editorial dos.</p><h1>Capítulo 1</h1><p>Historia.</p>',
      },
    ]);
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Capítulo 1',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Historia.');
  });

  it('uses TOC labels to omit editorial sections with unrelated visible headings', async () => {
    const epub = await createEpub(
      [
        {
          id: 'story',
          body: '<section id="legal"><h1>Legal information</h1><p>Editorial.</p></section><section id="story"><p>Historia sin encabezado.</p></section>',
        },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><a href="Text/story.xhtml#legal">Créditos</a><a href="Text/story.xhtml#story">El comienzo</a></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'El comienzo',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe('Historia sin encabezado.');
  });

  it('collapses whitespace across inline marks while preserving punctuation, split words and hard breaks', async () => {
    const epub = await createEpub([
      {
        id: 'story',
        body: '<h1>Capítulo 1</h1><p><span>Hello </span> <em> world</em><span> </span> <strong>again</strong><br />Next <i>line</i>. H<span>arry</span></p>',
      },
    ]);
    const parsed = await parseEpubArchive(epub);
    const nodes = nodesOfType(parsed.chapters, 'text');
    expect(nodes.map((node) => node['text']).join('')).toBe(
      'Hello world againNext line. Harry',
    );
    expect(nodesOfType(parsed.chapters, 'hardBreak')).toHaveLength(1);
    expect(nodes.find((node) => node['text'] === 'world')?.['marks']).toEqual([
      { type: 'italic' },
    ]);
    expect(nodes.find((node) => node['text'] === 'again')?.['marks']).toEqual([
      { type: 'bold' },
    ]);
  });

  it.each(['Seguir leyendo', 'Preview'])(
    'bounds a %s insert between main chapters and skips its sample continuations',
    async (label) => {
      const epub = await createEpub(
        [
          { id: 'first', body: '<h1>Capítulo 1</h1><p>Primera historia.</p>' },
          { id: 'promo', body: '<p>Promoción.</p>' },
          { id: 'sample', body: '<h1>Capítulo 1</h1><p>Adelanto.</p>' },
          { id: 'continuation', body: '<p>Más adelanto.</p>' },
          { id: 'second', body: '<h1>Capítulo 2</h1><p>Segunda historia.</p>' },
        ],
        {},
        {
          href: 'nav.xhtml',
          body: `<html><nav><ol><li><a href="Text/first.xhtml">Capítulo 1</a></li><li><a href="Text/promo.xhtml">${label}</a><ol><li><a href="Text/sample.xhtml">Capítulo 1 de otra obra</a></li></ol></li><li><a href="Text/second.xhtml">Capítulo 2</a></li></ol></nav></html>`,
        },
      );
      const parsed = await parseEpubArchive(epub);
      expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
        'Capítulo 1',
        'Capítulo 2',
      ]);
      expect(textFrom(parsed.chapters).join('')).toBe(
        'Primera historia.Segunda historia.',
      );
    },
  );

  it('preserves narrative before a promotional fragment and resumes after a sample before the first chapter', async () => {
    const epub = await createEpub(
      [
        {
          id: 'intro',
          body: '<section id="intro"><p>Introducción narrativa.</p></section><section id="start"><p>Promoción.</p></section>',
        },
        { id: 'sample', body: '<p>Adelanto.</p>' },
        { id: 'first', body: '<h1>Capítulo 1</h1><p>Historia.</p>' },
      ],
      {},
      {
        href: 'nav.xhtml',
        body: '<html><nav><ol><li><a href="Text/intro.xhtml#intro">Prólogo</a></li><li><a href="Text/intro.xhtml#start">Seguir leyendo</a><ol><li><a href="Text/sample.xhtml">Capítulo 1 de otra obra</a></li></ol></li><li><a href="Text/first.xhtml">Capítulo 1</a></li></ol></nav></html>',
      },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters.map((chapter) => chapter.title)).toEqual([
      'Prólogo',
      'Capítulo 1',
    ]);
    expect(textFrom(parsed.chapters).join('')).toBe(
      'Introducción narrativa.Historia.',
    );
  });

  it('preserves illustration pages before the first chapter in reading order', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const epub = await createEpub(
      [
        {
          id: 'illustration-one',
          body: '<p><img src="../Images/a.png" alt="Primera" /></p>',
        },
        {
          id: 'illustration-two',
          body: '<p><img src="../Images/a.png" alt="Segunda" /></p>',
        },
        { id: 'first', body: '<h1>Capítulo 1</h1><p>Historia.</p>' },
      ],
      { 'OEBPS/Images/a.png': png },
    );
    const parsed = await parseEpubArchive(epub);
    expect(parsed.chapters).toHaveLength(1);
    const content = parsed.chapters[0]?.scenes[0]?.content['content'] as Record<
      string,
      unknown
    >[];
    expect(content.map((node) => node['type'])).toEqual([
      'image',
      'image',
      'paragraph',
    ]);
    expect(
      nodesOfType(parsed.chapters, 'image').map(
        (node) => (node['attrs'] as Record<string, unknown>)['alt'],
      ),
    ).toEqual(['Primera', 'Segunda']);
  });
});
