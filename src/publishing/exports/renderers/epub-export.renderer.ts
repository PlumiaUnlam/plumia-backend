import { Injectable, Logger } from '@nestjs/common';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Epub from 'epub-gen';
import type { ExportRenderer } from '../export-renderer.port';
import type { ExportSettingsConfig } from '../export-settings.types';
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

@Injectable()
export class EpubExportRenderer implements ExportRenderer {
  readonly format = 'EPUB' as const;
  private readonly logger = new Logger(EpubExportRenderer.name);

  async render(
    document: ExportDocument,
    settings: ExportSettingsConfig,
  ): Promise<RenderedExport> {
    if (settings.header || settings.footer) {
      this.logger.warn(
        'La configuración de encabezado/pie de página no aplica a EPUB (formato reflowable); se ignora.',
      );
    }

    const workDir = await mkdtemp(join(tmpdir(), 'plumia-epub-'));
    const outputPath = join(workDir, 'export.epub');

    try {
      const images: ExportImage[] = [];
      for (const chapter of document.chapters) {
        for (const scene of chapter.scenes) {
          collectImages(scene.content, images);
        }
      }

      const imagePaths = new Map<ExportImage, string>();
      await Promise.all(
        images.map(async (image, index) => {
          const imagePath = join(workDir, `image-${index}.${image.extension}`);
          await writeFile(imagePath, image.buffer);
          imagePaths.set(image, imagePath);
        }),
      );

      // Cada entrada de `content` se escribe como su propio archivo XHTML
      // (spine item), que es el único salto de página que un lector EPUB
      // garantiza de verdad — por eso una escena por entrada, no un solo
      // bloque de HTML por libro con `page-break-after` (que la mayoría de
      // los lectores ignora dentro de un mismo archivo).
      const titlePage = {
        title: document.title,
        data: `<h1>${escapeHtml(document.title)}</h1>`,
      };

      const content: Array<{
        title: string;
        data: string;
        excludeFromToc?: boolean;
      }> = [titlePage];
      document.chapters.forEach((chapter) => {
        chapter.scenes.forEach((scene, sceneIndex) => {
          const parts: string[] = [];
          if (sceneIndex === 0) {
            parts.push(`<h2>${escapeHtml(chapter.title)}</h2>`);
          }
          if (scene.title) {
            parts.push(`<h3>${escapeHtml(scene.title)}</h3>`);
          }
          parts.push(
            blocksToHtml(scene.content, (image) =>
              imageFileUrl(imagePaths.get(image) ?? ''),
            ),
          );

          content.push({
            // Una entrada de TOC visible por capítulo; el resto de escenas
            // siguen siendo archivos separados (salto real), solo ocultas
            // del índice.
            title:
              sceneIndex === 0 ? chapter.title : (scene.title ?? chapter.title),
            data: parts.join('\n'),
            excludeFromToc: sceneIndex !== 0,
          });
        });
      });

      await new Epub(
        {
          title: document.title,
          author: 'PlumIA',
          publisher: 'PlumIA',
          lang: 'es',
          tocTitle: 'Contenido',
          appendChapterTitles: false,
          content,
          tempDir: workDir,
          css: `body { font-family: serif; padding: ${settings.margins.topCm}cm ${settings.margins.rightCm}cm ${settings.margins.bottomCm}cm ${settings.margins.leftCm}cm; } img { max-width: 100%; }`,
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
