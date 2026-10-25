import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';
import type { BookService } from './book.service';
import type { ChapterService } from './chapter.service';
import { ProjectStatus } from '../domain/project-status';
import type { BookRecord } from '../ports/book-repository.port';
import type { ChapterRecord } from '../ports/chapter-repository.port';
import type { ProjectRecord } from '../ports/project-repository.port';
import type {
  CreateSceneData,
  SceneRecord,
  SceneRepository,
} from '../ports/scene-repository.port';
import type { StorageService } from '../../storage/storage.service';
import type { ProjectService } from './project.service';
import { EpubImportService } from './epub-import.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function createEpub(
  body: string,
  files: Record<string, Buffer> = {},
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file(
    'META-INF/container.xml',
    '<container><rootfiles><rootfile full-path="OEBPS/book.opf" /></rootfiles></container>',
  );
  zip.file(
    'OEBPS/book.opf',
    '<package><metadata><title>Libro de prueba</title></metadata><manifest><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="chapter" /></spine></package>',
  );
  zip.file(
    'OEBPS/Text/chapter.xhtml',
    `<html><body><h2>Capítulo ilustrado</h2>${body}</body></html>`,
  );
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'nodebuffer' });
}

function nodesOfType(value: unknown, type: string): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => nodesOfType(item, type));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }

  const record = value as Record<string, unknown>;
  return [
    ...(record['type'] === type ? [record] : []),
    ...Object.values(record).flatMap((child) => nodesOfType(child, type)),
  ];
}

interface ImportHarness {
  service: EpubImportService;
  project: ProjectRecord;
  projectCreate: jest.Mock;
  projectRemove: jest.Mock;
  bookCreate: jest.Mock;
  chapterCreate: jest.Mock;
  sceneCreate: jest.Mock<
    Promise<SceneRecord | null>,
    [string, CreateSceneData]
  >;
  putBuffer: jest.Mock<Promise<void>, [string, Uint8Array, string]>;
  deleteObject: jest.Mock<Promise<void>, [string]>;
}

function createHarness(): ImportHarness {
  const project = {
    id: 'project-1',
    userId: 'user-1',
    title: 'Proyecto',
    description: null,
    genre: null,
    genreRules: null,
    wordCountTarget: null,
    status: ProjectStatus.DRAFT,
    createdAt: new Date('2025-01-01T00:00:00Z'),
    updatedAt: new Date('2025-01-01T00:00:00Z'),
    deletedAt: null,
  } satisfies ProjectRecord;
  const projectCreate = jest.fn().mockResolvedValue(project);
  const projectRemove = jest.fn().mockResolvedValue(project);
  const bookCreate = jest
    .fn()
    .mockResolvedValue({ id: 'book-1' } satisfies Partial<BookRecord>);
  const chapterCreate = jest
    .fn()
    .mockResolvedValue({ id: 'chapter-1' } satisfies Partial<ChapterRecord>);
  const sceneCreate = jest
    .fn<Promise<SceneRecord | null>, [string, CreateSceneData]>()
    .mockResolvedValue({ id: 'scene-1' } as SceneRecord);
  const putBuffer = jest
    .fn<Promise<void>, [string, Uint8Array, string]>()
    .mockResolvedValue(undefined);
  const deleteObject = jest
    .fn<Promise<void>, [string]>()
    .mockResolvedValue(undefined);

  const service = new EpubImportService(
    {
      create: projectCreate,
      remove: projectRemove,
    } as unknown as ProjectService,
    { create: bookCreate } as unknown as BookService,
    { create: chapterCreate } as unknown as ChapterService,
    { putBuffer, deleteObject } as unknown as StorageService,
    { createForUser: sceneCreate } as unknown as SceneRepository,
  );

  return {
    service,
    project,
    projectCreate,
    projectRemove,
    bookCreate,
    chapterCreate,
    sceneCreate,
    putBuffer,
    deleteObject,
  };
}

describe('EpubImportService', () => {
  it('imports chapters, scenes, images, and word counts', async () => {
    const harness = createHarness();
    const epub = await createEpub(
      '<p>Hola <img src="../Images/map.png" alt="Mapa" /> mundo.</p>',
      { 'OEBPS/Images/map.png': PNG },
    );

    const result = await harness.service.importEpub(
      'user-1',
      { title: 'Proyecto' },
      epub,
    );

    expect(result).toMatchObject({
      project: harness.project,
      importedChapters: 1,
      importedImages: 1,
      skippedImages: 0,
      importedWords: 2,
    });
    expect(harness.projectCreate).toHaveBeenCalledWith('user-1', {
      title: 'Proyecto',
    });
    expect(harness.bookCreate).toHaveBeenCalledWith('user-1', 'project-1', {
      title: 'Libro de prueba',
      sortKey: '001',
    });
    expect(harness.chapterCreate).toHaveBeenCalledWith(
      'user-1',
      'book-1',
      expect.objectContaining({ title: 'Capítulo ilustrado', sortKey: '001' }),
    );
    expect(harness.putBuffer).toHaveBeenCalledTimes(1);

    const [storageKey, uploadedImage, contentType] =
      harness.putBuffer.mock.calls[0] ?? [];
    expect(storageKey).toMatch(/^scenes\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/u);
    expect(uploadedImage).toEqual(PNG);
    expect(contentType).toBe('image/png');

    const [, sceneData] = harness.sceneCreate.mock.calls[0] ?? [];
    const image = nodesOfType(sceneData?.['content'], 'image')[0];
    expect(image?.['attrs']).toMatchObject({
      alt: 'Mapa',
      src: storageKey,
      storageKey,
    });
    expect(image?.['attrs']).not.toHaveProperty('epubAssetId');
  });

  it('skips an image that cannot be stored and keeps the scene text', async () => {
    const harness = createHarness();
    harness.putBuffer.mockRejectedValue(new Error('Storage unavailable'));
    const epub = await createEpub(
      '<p>Texto conservado <img src="../Images/map.png" alt="Mapa" /></p>',
      { 'OEBPS/Images/map.png': PNG },
    );

    const result = await harness.service.importEpub(
      'user-1',
      { title: 'Proyecto' },
      epub,
    );

    expect(result).toMatchObject({ importedImages: 0, skippedImages: 1 });
    const [, sceneData] = harness.sceneCreate.mock.calls[0] ?? [];
    expect(nodesOfType(sceneData?.['content'], 'image')).toHaveLength(0);
    expect(JSON.stringify(sceneData?.['content'])).toContain(
      'Texto conservado',
    );
  });

  it('maps invalid EPUB errors to a bad request before creating a project', async () => {
    const harness = createHarness();

    await expect(
      harness.service.importEpub(
        'user-1',
        { title: 'Proyecto' },
        Buffer.from('no epub'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(harness.projectCreate).not.toHaveBeenCalled();
  });

  it('deletes uploaded images and the project when scene persistence fails', async () => {
    const harness = createHarness();
    const failure = new Error('Scene persistence failed');
    harness.sceneCreate.mockRejectedValue(failure);
    const epub = await createEpub(
      '<p>Texto <img src="../Images/map.png" alt="Mapa" /></p>',
      { 'OEBPS/Images/map.png': PNG },
    );

    await expect(
      harness.service.importEpub('user-1', { title: 'Proyecto' }, epub),
    ).rejects.toBe(failure);

    const [storageKey] = harness.putBuffer.mock.calls[0] ?? [];
    expect(harness.deleteObject).toHaveBeenCalledWith(storageKey);
    expect(harness.projectRemove).toHaveBeenCalledWith('user-1', 'project-1');
  });
});
