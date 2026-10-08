import { Injectable } from '@nestjs/common';
import JSZip from 'jszip';
import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  RenderedExport,
} from '../export.types';
import { buildExportToc, exportAnchor } from '../export-toc';
import { sceneDividerSvg, type SceneDividerVariant } from '../scene-divider';
import { blocksToHtml, noteInlinesToHtml } from '../tiptap-export';

const EPUB_MIME_TYPE = 'application/epub+zip';
const OEBPS = 'OEBPS';
const COVER_FILENAME = 'cover.xhtml';
const INDEX_FILENAME = 'index.xhtml';
const NAV_FILENAME = 'toc.xhtml';
const NCX_FILENAME = 'toc.ncx';
const CSS_FILENAME = 'style.css';
const NOTES_FILENAME = 'notes.xhtml';
const COVER_IMAGE_FILENAME = 'cover-image.xhtml';

const CSS = `body { font-family: serif; }
h1, h2, h3 { text-align: center; }
img { max-width: 100%; }
p.image, p.scene-divider { text-align: center; }
p.scene-divider img { width: 50%; }
section.cover { margin: 0; padding: 0; text-align: center; }
img.cover { display: block; max-width: 100%; max-height: 100vh; margin: 0 auto; }
p.author { text-align: center; font-style: italic; }
.toc-level-0 { font-weight: bold; }
.toc-level-2 { margin-left: 2em; }
a.noteref { text-decoration: none; }
aside.footnote { display: none; }
ol.endnotes li { margin-bottom: 0.5em; }
`;

const CONTAINER_XML = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

interface ManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties?: string;
}

interface Endnote {
  chapterIndex: number;
  chapterTitle: string;
  number: number;
  html: string;
  sourceFile: string;
}

interface SpineItem {
  id: string;
  filename: string;
  title: string;
  body: string;
  inToc: boolean;
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function collectAssets(
  blocks: ExportBlock[],
  images: ExportImage[],
  dividers: Set<SceneDividerVariant>,
): void {
  for (const block of blocks) {
    if (block.kind === 'image') {
      if (!images.includes(block.image)) {
        images.push(block.image);
      }
    } else if (block.kind === 'sceneDivider') {
      dividers.add(block.variant);
    } else if (block.kind === 'bulletList' || block.kind === 'orderedList') {
      for (const item of block.items) {
        collectAssets(item, images, dividers);
      }
    }
  }
}

function xhtmlPage(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es" lang="es">
<head>
<meta charset="UTF-8" />
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="${CSS_FILENAME}" />
</head>
<body>
${body}
</body>
</html>`;
}

function noteRefHtml(id: string, href: string, number: number): string {
  return `<a epub:type="noteref" class="noteref" id="${id}" href="${escapeXml(href)}"><sup>${number}</sup></a>`;
}

function endnotesHtml(endnotes: Endnote[]): string {
  const groups: Array<{
    chapterIndex: number;
    chapterTitle: string;
    notes: Endnote[];
  }> = [];
  for (const note of endnotes) {
    const last = groups.at(-1);
    if (last && last.chapterIndex === note.chapterIndex) {
      last.notes.push(note);
    } else {
      groups.push({
        chapterIndex: note.chapterIndex,
        chapterTitle: note.chapterTitle,
        notes: [note],
      });
    }
  }

  const sections = groups
    .map(
      (group) => `<h2>${escapeXml(group.chapterTitle)}</h2>
<ol class="endnotes">
${group.notes
  .map(
    (note) =>
      `<li epub:type="endnote" id="en-${note.number}" value="${note.number}"><p>${note.html} <a href="${escapeXml(
        `${note.sourceFile}#enref-${note.number}`,
      )}">↩</a></p></li>`,
  )
  .join('\n')}
</ol>`,
    )
    .join('\n');

  return `<section epub:type="endnotes">
<h1>Notas</h1>
${sections}
</section>`;
}

function epubTimestamp(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

/**
 * Genera el EPUB 3 directamente en memoria. Las imágenes (ya comprimidas) se
 * guardan sin recomprimir (STORE); solo el texto (XHTML/OPF/CSS) usa DEFLATE.
 */
@Injectable()
export class EpubExportRenderer {
  readonly format = 'EPUB' as const;

  async render(document: ExportDocument): Promise<RenderedExport> {
    const zip = new JSZip();
    // `mimetype` debe ser la primera entrada del ZIP y sin comprimir.
    zip.file('mimetype', EPUB_MIME_TYPE, { compression: 'STORE' });
    zip.file('META-INF/container.xml', CONTAINER_XML);

    const manifest: ManifestItem[] = [
      {
        id: 'nav',
        href: NAV_FILENAME,
        mediaType: 'application/xhtml+xml',
        properties: 'nav',
      },
      { id: 'ncx', href: NCX_FILENAME, mediaType: 'application/x-dtbncx+xml' },
      { id: 'css', href: CSS_FILENAME, mediaType: 'text/css' },
    ];

    const images: ExportImage[] = [];
    const dividers = new Set<SceneDividerVariant>();
    for (const chapter of document.chapters) {
      for (const scene of chapter.scenes) {
        collectAssets(scene.content, images, dividers);
      }
    }

    const imageHrefs = new Map<ExportImage, string>();
    images.forEach((image, index) => {
      const href = `images/image-${index}.${image.extension}`;
      imageHrefs.set(image, href);
      zip.file(`${OEBPS}/${href}`, image.buffer, { compression: 'STORE' });
      manifest.push({
        id: `image-${index}`,
        href,
        mediaType: image.mimeType,
      });
    });

    const dividerHrefs = new Map<SceneDividerVariant, string>();
    for (const variant of dividers) {
      const href = `images/divider-${variant}.svg`;
      dividerHrefs.set(variant, href);
      zip.file(`${OEBPS}/${href}`, sceneDividerSvg(variant));
      manifest.push({
        id: `divider-${variant}`,
        href,
        mediaType: 'image/svg+xml',
      });
    }

    const chapterFilenames = new Map<string, string>();
    const sceneFilenames = new Map<string, string>();
    document.chapters.forEach((chapter, chapterIndex) => {
      if (chapter.scenes.length === 0) {
        chapterFilenames.set(
          chapter.id,
          `book-0-chapter-${chapterIndex}.xhtml`,
        );
        return;
      }

      chapter.scenes.forEach((scene, sceneIndex) => {
        const filename = `book-0-chapter-${chapterIndex}-scene-${sceneIndex}.xhtml`;
        sceneFilenames.set(scene.id, filename);
        if (sceneIndex === 0) {
          chapterFilenames.set(chapter.id, filename);
        }
      });
    });

    const tocHtml = buildExportToc(document)
      .map((entry) => {
        const target =
          entry.kind === 'book'
            ? COVER_FILENAME
            : entry.kind === 'chapter'
              ? chapterFilenames.get(entry.id)
              : sceneFilenames.get(entry.id);
        return `<p class="toc-level-${entry.level}"><a href="${escapeXml(
          `${target ?? COVER_FILENAME}#${entry.anchor}`,
        )}">${escapeXml(entry.title)}</a></p>`;
      })
      .join('\n');

    // Cada escena es su propio archivo XHTML (spine item): es el único salto
    // de página que un lector EPUB garantiza de verdad (la mayoría ignora
    // `page-break-after` dentro de un mismo archivo).
    const spine: SpineItem[] = [
      {
        id: 'cover',
        filename: COVER_FILENAME,
        title: document.title,
        body: `<h1 id="${exportAnchor('book', document.id)}">${escapeXml(
          document.title,
        )}</h1>
<p class="author">${escapeXml(document.author)}</p>`,
        inToc: true,
      },
      {
        id: 'index',
        filename: INDEX_FILENAME,
        title: 'Índice',
        body: '',
        inToc: false,
      },
    ];

    // Notas al pie: numeradas por capítulo, como <aside epub:type="footnote">
    // al final del archivo de su escena. Quedan ocultas en la página
    // (`aside.footnote { display: none }`) y solo se ven como popup al tocar
    // el número. Notas al final: numeradas en todo el libro, en notes.xhtml.
    const endnotes: Endnote[] = [];

    document.chapters.forEach((chapter, chapterIndex) => {
      let footnoteCount = 0;
      const chapterHeading = `<h2 id="${exportAnchor(
        'chapter',
        chapter.id,
      )}">${escapeXml(chapter.title)}</h2>`;

      if (chapter.scenes.length === 0) {
        spine.push({
          id: `chapter-${chapterIndex}`,
          filename: chapterFilenames.get(chapter.id)!,
          title: chapter.title,
          body: chapterHeading,
          inToc: true,
        });
        return;
      }

      chapter.scenes.forEach((scene, sceneIndex) => {
        const parts: string[] = [];
        if (sceneIndex === 0) {
          parts.push(chapterHeading);
        }
        if (scene.title) {
          parts.push(
            `<h3 id="${exportAnchor('scene', scene.id)}">${escapeXml(
              scene.title,
            )}</h3>`,
          );
        }
        const sceneFile = sceneFilenames.get(scene.id)!;
        const footnotes: string[] = [];
        parts.push(
          blocksToHtml(scene.content, {
            imageSrc: (image) => imageHrefs.get(image) ?? '',
            sceneDividerSrc: (variant) => dividerHrefs.get(variant) ?? '',
            noteRef: (note) => {
              const html = noteInlinesToHtml(note.inlines);
              if (note.noteKind === 'endnote') {
                const number = endnotes.length + 1;
                endnotes.push({
                  chapterIndex,
                  chapterTitle: chapter.title,
                  number,
                  html,
                  sourceFile: sceneFile,
                });
                return noteRefHtml(
                  `enref-${number}`,
                  `${NOTES_FILENAME}#en-${number}`,
                  number,
                );
              }

              footnoteCount += 1;
              const id = `fn-c${chapterIndex}-${footnoteCount}`;
              footnotes.push(
                `<aside epub:type="footnote" class="footnote" id="${id}"><p><a href="#${id}-ref">${footnoteCount}</a>. ${html}</p></aside>`,
              );
              return noteRefHtml(`${id}-ref`, `#${id}`, footnoteCount);
            },
          }),
        );
        parts.push(...footnotes);

        spine.push({
          id: `chapter-${chapterIndex}-scene-${sceneIndex}`,
          filename: sceneFile,
          // Una entrada de TOC visible por capítulo; el resto de escenas
          // siguen siendo archivos separados, solo ocultas del índice.
          title:
            sceneIndex === 0 ? chapter.title : (scene.title ?? chapter.title),
          body: parts.join('\n'),
          inToc: sceneIndex === 0,
        });
      });
    });

    if (endnotes.length > 0) {
      spine.push({
        id: 'notes',
        filename: NOTES_FILENAME,
        title: 'Notas',
        body: endnotesHtml(endnotes),
        inToc: true,
      });
    }

    spine[1]!.body = `<h1>Índice</h1>\n${tocHtml}${
      endnotes.length > 0
        ? `\n<p class="toc-level-1"><a href="${NOTES_FILENAME}">Notas</a></p>`
        : ''
    }`;

    // La portada (si hay) es la primera página del spine, antes del título.
    if (document.cover) {
      const href = `images/cover.${document.cover.extension}`;
      zip.file(`${OEBPS}/${href}`, document.cover.buffer, {
        compression: 'STORE',
      });
      manifest.push({
        id: 'cover-image',
        href,
        mediaType: document.cover.mimeType,
        properties: 'cover-image',
      });
      spine.unshift({
        id: 'cover-page',
        filename: COVER_IMAGE_FILENAME,
        title: document.title,
        body: `<section epub:type="cover" class="cover"><img class="cover" src="${href}" alt="Portada" /></section>`,
        inToc: false,
      });
    }

    for (const item of spine) {
      zip.file(`${OEBPS}/${item.filename}`, xhtmlPage(item.title, item.body));
      manifest.push({
        id: item.id,
        href: item.filename,
        mediaType: 'application/xhtml+xml',
      });
    }

    const tocItems = spine.filter((item) => item.inToc);
    const identifier = `urn:uuid:${document.id}`;

    zip.file(`${OEBPS}/${CSS_FILENAME}`, CSS);
    zip.file(
      `${OEBPS}/${NAV_FILENAME}`,
      xhtmlPage(
        'Contenido',
        `<nav epub:type="toc" id="toc">
<h1>Contenido</h1>
<ol>
${tocItems
  .map(
    (item) =>
      `<li><a href="${escapeXml(item.filename)}">${escapeXml(item.title)}</a></li>`,
  )
  .join('\n')}
</ol>
</nav>`,
      ),
    );
    zip.file(
      `${OEBPS}/${NCX_FILENAME}`,
      `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(identifier)}"/></head>
<docTitle><text>${escapeXml(document.title)}</text></docTitle>
<navMap>
${tocItems
  .map(
    (item, index) =>
      `<navPoint id="navpoint-${index + 1}" playOrder="${index + 1}"><navLabel><text>${escapeXml(
        item.title,
      )}</text></navLabel><content src="${escapeXml(item.filename)}"/></navPoint>`,
  )
  .join('\n')}
</navMap>
</ncx>`,
    );
    zip.file(
      `${OEBPS}/content.opf`,
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="es">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">${escapeXml(identifier)}</dc:identifier>
<dc:title>${escapeXml(document.title)}</dc:title>
<dc:language>es</dc:language>
<dc:creator>${escapeXml(document.author)}</dc:creator>
<dc:publisher>PlumIA</dc:publisher>
<meta property="dcterms:modified">${epubTimestamp(new Date())}</meta>${
        document.cover ? '\n<meta name="cover" content="cover-image"/>' : ''
      }
</metadata>
<manifest>
${manifest
  .map(
    (item) =>
      `<item id="${escapeXml(item.id)}" href="${escapeXml(item.href)}" media-type="${item.mediaType}"${
        item.properties ? ` properties="${item.properties}"` : ''
      }/>`,
  )
  .join('\n')}
</manifest>
<spine toc="ncx">
${spine.map((item) => `<itemref idref="${escapeXml(item.id)}"/>`).join('\n')}
</spine>
</package>`,
    );

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
      mimeType: EPUB_MIME_TYPE,
    });

    return { buffer, contentType: EPUB_MIME_TYPE, extension: 'EPUB' };
  }
}
