import { Injectable } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Epub from 'epub-gen';
import type { ExportRenderer } from '../export-renderer.port';
import type {
  ExportBlock,
  ExportDocument,
  ExportImage,
  RenderedExport,
} from '../export.types';
import { exportAnchor } from '../export-toc';
import { blocksToHtml } from '../tiptap-export';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function collectImages(blocks: ExportBlock[], images: ExportImage[]): void {
  for (const block of blocks) {
    if (block.kind === 'image') {
      if (!images.includes(block.image)) {
        images.push(block.image);
      }
    } else if (block.kind === 'bulletList' || block.kind === 'orderedList') {
      for (const item of block.items) {
        collectImages(item, images);
      }
    }
  }
}

function imageFileUrl(path: string): string {
  return `file://${path.replaceAll('\\', '/')}`;
}

function bookFilename(index: number): string {
  return `book-${index}.xhtml`;
}

function tocHtml(
  document: ExportDocument,
  locations: ReadonlyMap<string, string>,
): string {
  const entries = document.toc
    .map((entry) => {
      const href = locations.get(entry.anchor);
      if (!href) {
        return '';
      }

      return `<li class="toc-entry toc-level-${entry.level}"><a href="${escapeHtml(href)}">${escapeHtml(entry.title)}</a></li>`;
    })
    .join('\n');

  return `<h1>Índice</h1><ul class="toc">${entries}</ul>`;
}

@Injectable()
export class EpubExportRenderer implements ExportRenderer {
  readonly format = 'EPUB' as const;

  async render(document: ExportDocument): Promise<RenderedExport> {
    const workDir = await mkdtemp(join(tmpdir(), 'plumia-epub-'));
    const outputPath = join(workDir, 'export.epub');

    try {
      const images: ExportImage[] = [];
      for (const book of document.books) {
        for (const chapter of book.chapters) {
          for (const scene of chapter.scenes) {
            collectImages(scene.content, images);
          }
        }
      }

      const imagePaths = new Map<ExportImage, string>();
      for (const [index, image] of images.entries()) {
        const imagePath = join(workDir, `image-${index}.${image.extension}`);
        await writeFile(imagePath, image.buffer);
        imagePaths.set(image, imagePath);
      }

      const locations = new Map<string, string>([
        [
          exportAnchor('project', document.id),
          `cover.xhtml#${exportAnchor('project', document.id)}`,
        ],
      ]);

      document.books.forEach((book, bookIndex) => {
        const filename = bookFilename(bookIndex);
        locations.set(
          exportAnchor('book', book.id),
          `${filename}#${exportAnchor('book', book.id)}`,
        );
        for (const chapter of book.chapters) {
          locations.set(
            exportAnchor('chapter', chapter.id),
            `${filename}#${exportAnchor('chapter', chapter.id)}`,
          );
          for (const scene of chapter.scenes) {
            if (scene.title) {
              locations.set(
                exportAnchor('scene', scene.id),
                `${filename}#${exportAnchor('scene', scene.id)}`,
              );
            }
          }
        }
      });

      const content = [
        {
          title: 'Portada',
          filename: 'cover.xhtml',
          excludeFromToc: true,
          data: `<h1 id="${exportAnchor('project', document.id)}">${escapeHtml(document.title)}</h1>`,
        },
        {
          title: 'Índice',
          filename: 'index.xhtml',
          excludeFromToc: true,
          data: tocHtml(document, locations),
        },
        ...document.books.map((book, bookIndex) => ({
          title: book.title,
          filename: bookFilename(bookIndex),
          data: [
            `<h1 id="${exportAnchor('book', book.id)}">${escapeHtml(book.title)}</h1>`,
            ...book.chapters.flatMap((chapter) => [
              `<h2 id="${exportAnchor('chapter', chapter.id)}">${escapeHtml(chapter.title)}</h2>`,
              ...chapter.scenes.flatMap((scene) => [
                scene.title
                  ? `<h3 id="${exportAnchor('scene', scene.id)}">${escapeHtml(scene.title)}</h3>`
                  : '',
                blocksToHtml(scene.content, (image) =>
                  imageFileUrl(imagePaths.get(image) ?? ''),
                ),
              ]),
            ]),
          ].join('\n'),
        })),
      ];

      await new Epub(
        {
          title: document.title,
          author: 'PlumIA',
          publisher: 'PlumIA',
          lang: 'es',
          tocTitle: 'Índice',
          appendChapterTitles: false,
          content,
          tempDir: workDir,
          css: [
            'body { font-family: serif; }',
            'img { max-width: 100%; }',
            '.toc { list-style: none; padding: 0; }',
            '.toc-entry { margin: 0.35em 0; }',
            '.toc-level-1 { margin-left: 1em; }',
            '.toc-level-2 { margin-left: 2em; }',
            '.toc-level-3 { margin-left: 3em; }',
          ].join(' '),
        },
        outputPath,
      ).promise;

      return {
        buffer: await readFile(outputPath),
        contentType: 'application/epub+zip',
        extension: 'EPUB',
      };
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
