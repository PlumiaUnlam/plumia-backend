import type { Prisma } from '@prisma/client';
import JSZip from 'jszip';
import { EpubExportRenderer } from '../../../src/publishing/exports/renderers/epub-export.renderer';
import type { ExportContentSource } from '../../../src/publishing/exports/export-source.port';
import { prepareExportDocument } from '../../../src/publishing/exports/tiptap-export';

const variants = [
  'flourish',
  'diamonds',
  'stars',
  'waves',
  'dots',
  'asterisks',
  'moon',
] as const;

function sourceWith(content: Prisma.JsonArray): ExportContentSource {
  return {
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
            content: { type: 'doc', content },
          },
        ],
      },
    ],
  };
}

const noImage = (): Promise<never> =>
  Promise.reject(new Error('no image expected'));

describe('export scene dividers', () => {
  it('keeps every divider variant as its own distinct SVG in the EPUB', async () => {
    const document = await prepareExportDocument(
      sourceWith(
        variants.map((variant) => ({
          type: 'sceneDivider',
          attrs: { variant },
        })),
      ),
      noImage,
    );
    expect(document.chapters[0]?.scenes[0]?.content).toEqual(
      variants.map((variant) => ({ kind: 'sceneDivider', variant })),
    );

    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    const svgs = await Promise.all(
      variants.map((variant) =>
        zip.files[`OEBPS/images/divider-${variant}.svg`]!.async('string'),
      ),
    );
    expect(new Set(svgs).size).toBe(variants.length);

    const opf = await zip.files['OEBPS/content.opf']!.async('string');
    for (const variant of variants) {
      expect(opf).toContain(
        `href="images/divider-${variant}.svg" media-type="image/svg+xml"`,
      );
    }
  });

  it('only embeds the divider variants actually used', async () => {
    const document = await prepareExportDocument(
      sourceWith([{ type: 'sceneDivider', attrs: { variant: 'stars' } }]),
      noImage,
    );
    expect(document.chapters[0]?.scenes[0]?.content).toEqual([
      { kind: 'sceneDivider', variant: 'stars' },
    ]);

    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    const svgFiles = Object.keys(zip.files).filter((name) =>
      name.endsWith('.svg'),
    );
    expect(svgFiles).toEqual(['OEBPS/images/divider-stars.svg']);

    const scene =
      await zip.files['OEBPS/book-0-chapter-0-scene-0.xhtml']!.async('string');
    expect(scene).toContain('src="images/divider-stars.svg"');
  });

  it('renders a horizontal rule as <hr />, not a Unicode glyph', async () => {
    const document = await prepareExportDocument(
      sourceWith([
        { type: 'paragraph', content: [{ type: 'text', text: 'Antes.' }] },
        { type: 'horizontalRule' },
        { type: 'paragraph', content: [{ type: 'text', text: 'Después.' }] },
      ]),
      noImage,
    );

    const epub = await new EpubExportRenderer().render(document);
    const zip = await JSZip.loadAsync(epub.buffer);

    const scene =
      await zip.files['OEBPS/book-0-chapter-0-scene-0.xhtml']!.async('string');
    expect(scene).toContain('<hr />');
    expect(scene).not.toContain('⁂');
  });
});
