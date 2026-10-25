import { BadRequestException } from '@nestjs/common';
import { ProjectStatus } from '../domain/project-status';
import type { ProjectRecord } from '../ports/project-repository.port';
import type { EpubImportService } from '../services/epub-import.service';
import { EpubImportController } from './epub-import.controller';

describe('EpubImportController', () => {
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

  function createController(): {
    controller: EpubImportController;
    importEpub: jest.MockedFunction<EpubImportService['importEpub']>;
    request: { user: { id: string }; body: Record<string, unknown> };
  } {
    const importEpub: jest.MockedFunction<EpubImportService['importEpub']> =
      jest.fn().mockResolvedValue({
        project,
        importedChapters: 2,
        importedImages: 3,
        skippedImages: 1,
        importedWords: 120,
      });
    const controller = new EpubImportController({
      importEpub,
    } as unknown as EpubImportService);
    const request = {
      user: { id: 'user-1' },
      body: {
        project: JSON.stringify({
          title: ' Proyecto ',
          description: 'Descripción',
          genre: 'Fantasía',
          wordCountTarget: 120,
        }),
      },
    };
    return { controller, importEpub, request };
  }

  it('rejects a missing upload', async () => {
    const { controller, importEpub, request } = createController();

    await expect(
      controller.importEpub(request as never, undefined),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importEpub).not.toHaveBeenCalled();
  });

  it('rejects files that do not have the EPUB extension', async () => {
    const { controller, importEpub, request } = createController();

    await expect(
      controller.importEpub(request as never, {
        originalname: 'manuscript.pdf',
        buffer: Buffer.from('file'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importEpub).not.toHaveBeenCalled();
  });

  it('validates project JSON, delegates the import, and returns its summary', async () => {
    const { controller, importEpub, request } = createController();
    const buffer = Buffer.from('epub-content');
    const result = await controller.importEpub(request as never, {
      originalname: 'manuscript.EPUB',
      buffer,
    });

    expect(importEpub).toHaveBeenCalledWith(
      'user-1',
      {
        title: 'Proyecto',
        description: 'Descripción',
        genre: 'Fantasía',
        wordCountTarget: 120,
      },
      buffer,
    );
    expect(result).toMatchObject({
      project: {
        id: 'project-1',
        title: 'Proyecto',
        status: ProjectStatus.DRAFT,
      },
      importedChapters: 2,
      importedImages: 3,
      skippedImages: 1,
      importedWords: 120,
    });
  });

  it('rejects malformed project JSON without calling the import service', async () => {
    const { controller, importEpub, request } = createController();
    const invalidRequest = {
      ...request,
      body: { project: '{invalid json' },
    };

    await expect(
      controller.importEpub(invalidRequest as never, {
        originalname: 'manuscript.epub',
        buffer: Buffer.from('epub-content'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importEpub).not.toHaveBeenCalled();
  });

  it.each([
    ['missing project data', undefined],
    ['a non-object project payload', '[]'],
    ['a title that is not text', JSON.stringify({ title: 42 })],
    ['an empty project title', JSON.stringify({ title: '   ' })],
    ['a title over the limit', JSON.stringify({ title: 'x'.repeat(201) })],
    [
      'a genre over the limit',
      JSON.stringify({ title: 'Proyecto', genre: 'x'.repeat(101) }),
    ],
    [
      'a non-positive word target',
      JSON.stringify({ title: 'Proyecto', wordCountTarget: 0 }),
    ],
    [
      'a fractional word target',
      JSON.stringify({ title: 'Proyecto', wordCountTarget: 1.5 }),
    ],
  ])('rejects %s', async (_case, projectInput) => {
    const { controller, importEpub } = createController();
    const request = {
      user: { id: 'user-1' },
      body: { project: projectInput },
    };

    await expect(
      controller.importEpub(request as never, {
        originalname: 'manuscript.epub',
        buffer: Buffer.from('epub-content'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importEpub).not.toHaveBeenCalled();
  });

  it('rejects a non-object request body', async () => {
    const { controller, importEpub } = createController();

    await expect(
      controller.importEpub({ user: { id: 'user-1' }, body: null } as never, {
        originalname: 'manuscript.epub',
        buffer: Buffer.from('epub-content'),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(importEpub).not.toHaveBeenCalled();
  });
});
