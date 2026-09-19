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
      if (!images.includes(block.image)) images.push(block.image);
    } else if (block.kind === 'bulletList' || block.kind === 'orderedList') {
      for (const item of block.items) collectImages(item, images);
    }
  }
}

function imageFileUrl(path: string): string {
  return `file://${path.replaceAll('\\', '/')}`;
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

      const content = document.books.map((book) => ({
        title: book.title,
        data: [
          `<h1>${escapeHtml(book.title)}</h1>`,
          ...book.chapters.flatMap((chapter) => [
            `<h2>${escapeHtml(chapter.title)}</h2>`,
            ...chapter.scenes.flatMap((scene) => [
              scene.title ? `<h3>${escapeHtml(scene.title)}</h3>` : '',
              blocksToHtml(scene.content, (image) =>
                imageFileUrl(imagePaths.get(image) ?? ''),
              ),
            ]),
          ]),
        ].join('\n'),
      }));

      await new Epub(
        {
          title: document.title,
          author: 'PlumIA',
          publisher: 'PlumIA',
          lang: 'es',
          tocTitle: 'Contenido',
          content,
          tempDir: workDir,
          css: 'body { font-family: serif; } img { max-width: 100%; }',
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
