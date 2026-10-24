import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../../storage/storage.service';
import { ChapterService } from './chapter.service';
import { ProjectService } from './project.service';
import { BookService } from './book.service';
import {
  SCENE_REPOSITORY,
  type SceneRepository,
} from '../ports/scene-repository.port';
import type { CreateProjectDto } from '../dto/projects/create-project.dto';
import type { ProjectRecord } from '../ports/project-repository.port';
import {
  imageIdFromNode,
  parseEpubArchive,
  type EpubImportImage,
} from '../domain/epub-import.parser';

type ImportSummary = {
  project: ProjectRecord;
  importedChapters: number;
  importedImages: number;
  skippedImages: number;
  importedWords: number;
};

type ImageImportStats = {
  imported: number;
  skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function plainText(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(plainText).join(' ');
  }
  if (!isRecord(value)) {
    return '';
  }
  const ownText =
    value['type'] === 'text' && typeof value['text'] === 'string'
      ? value['text']
      : '';
  return `${ownText} ${plainText(value['content'])}`;
}

function countWords(content: Record<string, unknown>): number {
  const text = plainText(content).trim();
  return text ? text.split(/\s+/u).length : 0;
}

async function attachImages(
  value: unknown,
  sceneId: string,
  images: Map<string, EpubImportImage>,
  storage: StorageService,
  uploadedKeys: string[],
): Promise<{ value: unknown; stats: ImageImportStats }> {
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    const stats = { imported: 0, skipped: 0 };
    for (const item of value) {
      const transformed = await attachImages(
        item,
        sceneId,
        images,
        storage,
        uploadedKeys,
      );
      if (transformed.value !== null) {
        result.push(transformed.value);
      }
      stats.imported += transformed.stats.imported;
      stats.skipped += transformed.stats.skipped;
    }
    return { value: result, stats };
  }
  if (!isRecord(value)) {
    return { value, stats: { imported: 0, skipped: 0 } };
  }

  const node = { ...value };
  const stats = { imported: 0, skipped: 0 };
  if (Array.isArray(value['content'])) {
    const transformed = await attachImages(
      value['content'],
      sceneId,
      images,
      storage,
      uploadedKeys,
    );
    node['content'] = transformed.value;
    stats.imported += transformed.stats.imported;
    stats.skipped += transformed.stats.skipped;
  }

  if (value['type'] !== 'image') {
    return { value: node, stats };
  }

  const attrs = isRecord(value['attrs']) ? { ...value['attrs'] } : {};
  const imageId = imageIdFromNode(value);
  delete attrs['epubAssetId'];
  const image = imageId ? images.get(imageId) : undefined;
  if (!image) {
    return { value: null, stats: { imported: 0, skipped: 1 } };
  }

  const storageKey = `scenes/${sceneId}/${randomUUID()}.${image.extension}`;
  try {
    await storage.putBuffer(storageKey, image.buffer, image.contentType);
  } catch {
    return { value: null, stats: { imported: 0, skipped: 1 } };
  }

  uploadedKeys.push(storageKey);
  attrs['src'] = storageKey;
  attrs['storageKey'] = storageKey;
  node['attrs'] = attrs;
  stats.imported += 1;
  return { value: node, stats };
}

@Injectable()
export class EpubImportService {
  constructor(
    private readonly projectService: ProjectService,
    private readonly bookService: BookService,
    private readonly chapterService: ChapterService,
    private readonly storageService: StorageService,
    @Inject(SCENE_REPOSITORY)
    private readonly sceneRepository: SceneRepository,
  ) {}

  async importEpub(
    userId: string,
    projectInput: CreateProjectDto,
    epubBuffer: Buffer,
  ): Promise<ImportSummary> {
    const epub = await parseEpubArchive(epubBuffer);
    const project = await this.projectService.create(userId, projectInput);
    const uploadedKeys: string[] = [];
    let importedImages = 0;
    let skippedImages = epub.skippedImages;
    let importedWords = 0;

    try {
      const book = await this.bookService.create(userId, project.id, {
        title: epub.title.slice(0, 200),
        sortKey: '001',
      });

      for (const [index, chapterInput] of epub.chapters.entries()) {
        const chapter = await this.chapterService.create(userId, book.id, {
          title: chapterInput.title.slice(0, 200),
          sortKey: String(index + 1).padStart(3, '0'),
        });
        for (const [sceneIndex, sceneInput] of chapterInput.scenes.entries()) {
          const sceneId = randomUUID();
          const transformed = await attachImages(
            sceneInput.content,
            sceneId,
            epub.images,
            this.storageService,
            uploadedKeys,
          );
          const content = transformed.value as Record<string, unknown>;
          const wordCount = countWords(content);
          const scene = await this.sceneRepository.createForUser(userId, {
            id: sceneId,
            chapterId: chapter.id,
            title: sceneInput.title.slice(0, 200),
            sortKey: String(sceneIndex + 1).padStart(3, '0'),
            order: sceneIndex + 1,
            content,
            wordCount,
          });
          if (!scene) {
            throw new NotFoundException(
              'No se pudo crear una escena del EPUB.',
            );
          }

          importedImages += transformed.stats.imported;
          skippedImages += transformed.stats.skipped;
          importedWords += wordCount;
        }
      }

      return {
        project,
        importedChapters: epub.chapters.length,
        importedImages,
        skippedImages,
        importedWords,
      };
    } catch (error) {
      await Promise.allSettled(
        uploadedKeys.map((key) => this.storageService.deleteObject(key)),
      );
      await this.projectService
        .remove(userId, project.id)
        .catch(() => undefined);
      throw error;
    }
  }
}
