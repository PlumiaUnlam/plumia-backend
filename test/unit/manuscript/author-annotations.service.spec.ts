import { BadRequestException, NotFoundException } from '@nestjs/common';
import { type PrismaService } from '../../../src/prisma/prisma.service';
import { AuthorAnnotationsService } from '../../../src/manuscript/services/author-annotations.service';

interface AnnotationUpdateArgs {
  where: { id: string };
  data: Record<string, unknown>;
  include?: unknown;
  select?: unknown;
}

describe('AuthorAnnotationsService', () => {
  let service: AuthorAnnotationsService;
  let prisma: {
    scene: { findFirst: jest.Mock<Promise<unknown>, [unknown]> };
    authorAnnotation: {
      findFirst: jest.Mock<Promise<unknown>, [unknown]>;
      findMany: jest.Mock<Promise<unknown>, [unknown]>;
      create: jest.Mock<Promise<unknown>, [unknown]>;
      update: jest.Mock<Promise<unknown>, [AnnotationUpdateArgs]>;
    };
  };

  beforeEach(() => {
    prisma = {
      scene: { findFirst: jest.fn<Promise<unknown>, [unknown]>() },
      authorAnnotation: {
        findFirst: jest
          .fn<Promise<unknown>, [unknown]>()
          .mockResolvedValue({ id: 'annotation-1' }),
        findMany: jest.fn<Promise<unknown>, [unknown]>(),
        create: jest.fn<Promise<unknown>, [unknown]>(),
        update: jest.fn<Promise<unknown>, [AnnotationUpdateArgs]>(),
      },
    };
    service = new AuthorAnnotationsService(prisma as unknown as PrismaService);
  });

  it('lists active annotations after checking scene ownership', async () => {
    const annotations = [{ id: 'annotation-1' }, { id: 'annotation-2' }];
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-1' });
    prisma.authorAnnotation.findMany.mockResolvedValue(annotations);

    await expect(service.list('user-1', 'scene-1')).resolves.toEqual(
      annotations,
    );
    expect(prisma.authorAnnotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sceneId: 'scene-1', deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );

    prisma.scene.findFirst.mockResolvedValue(null);
    await expect(service.list('user-1', 'scene-1')).rejects.toThrow(
      new NotFoundException('No se encontró la escena'),
    );
  });

  it('creates unanchored and anchored annotations with normalized text context', async () => {
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-1' });
    prisma.authorAnnotation.create.mockResolvedValue({ id: 'annotation-1' });

    await expect(
      service.create('user-1', 'scene-1', {
        body: '  A useful note  ',
        quote: '   ',
        contextBefore: 'b'.repeat(250),
        contextAfter: 'a'.repeat(250),
      }),
    ).resolves.toMatchObject({ id: 'annotation-1' });
    const createCalls = prisma.authorAnnotation.create.mock.calls as Array<
      [{ data: Record<string, unknown> }]
    >;
    expect(createCalls[0]?.[0].data).toMatchObject({
      body: 'A useful note',
      quote: null,
      anchorFrom: null,
      anchorTo: null,
      contextBefore: 'b'.repeat(200),
      contextAfter: 'a'.repeat(200),
    });

    await service.create('user-1', 'scene-1', {
      body: 'Anchored note',
      quote: ' selected text ',
      anchorFrom: 3,
      anchorTo: 8,
    });
    expect(createCalls[1]?.[0].data).toMatchObject({
      quote: 'selected text',
      anchorFrom: 3,
      anchorTo: 8,
    });
  });

  it.each([
    [
      { body: 'Note', anchorFrom: 2 },
      'La referencia al texto seleccionado no es válida',
    ],
    [
      { body: 'Note', quote: 'selected' },
      'La referencia al texto seleccionado no es válida',
    ],
    [
      { body: 'Note', anchorFrom: 3, anchorTo: 3 },
      'Selecciona un fragmento de texto válido',
    ],
    [
      { body: 'Note', quote: 'q'.repeat(3001), anchorFrom: 0, anchorTo: 1 },
      'El fragmento seleccionado es demasiado largo',
    ],
    [{ body: '   ' }, 'La anotación no puede estar vacía'],
  ])('rejects malformed annotation text or anchors', async (dto, message) => {
    prisma.scene.findFirst.mockResolvedValue({ id: 'scene-1' });

    await expect(service.create('user-1', 'scene-1', dto)).rejects.toThrow(
      new BadRequestException(message),
    );
    expect(prisma.authorAnnotation.create).not.toHaveBeenCalled();
  });

  it('marks an annotation resolved after checking that it belongs to the author', async () => {
    prisma.authorAnnotation.update.mockResolvedValue({
      id: 'annotation-1',
      resolvedAt: new Date(),
    });

    await expect(
      service.update('user-1', 'scene-1', 'annotation-1', {
        isResolved: true,
      }),
    ).resolves.toMatchObject({ id: 'annotation-1' });

    expect(prisma.authorAnnotation.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'annotation-1',
        sceneId: 'scene-1',
        deletedAt: null,
        scene: {
          chapter: { book: { project: { userId: 'user-1', deletedAt: null } } },
        },
      },
      select: { id: true },
    });
    expect(prisma.authorAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'annotation-1' } }),
    );
    expect(
      prisma.authorAnnotation.update.mock.calls[0]?.[0].data['resolvedAt'],
    ).toBeInstanceOf(Date);
  });

  it('reopens a resolved annotation by clearing resolvedAt', async () => {
    prisma.authorAnnotation.update.mockResolvedValue({
      id: 'annotation-1',
      resolvedAt: null,
    });

    await expect(
      service.update('user-1', 'scene-1', 'annotation-1', {
        isResolved: false,
      }),
    ).resolves.toMatchObject({ resolvedAt: null });

    expect(prisma.authorAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { resolvedAt: null } }),
    );
  });

  it('updates annotation text and normalizes empty bodies before saving', async () => {
    prisma.authorAnnotation.update.mockResolvedValue({
      id: 'annotation-1',
      body: 'Revised note',
    });

    await expect(
      service.update('user-1', 'scene-1', 'annotation-1', {
        body: '  Revised note  ',
      }),
    ).resolves.toMatchObject({ body: 'Revised note' });
    expect(prisma.authorAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { body: 'Revised note' } }),
    );

    await expect(
      service.update('user-1', 'scene-1', 'annotation-1', { body: '   ' }),
    ).rejects.toThrow(
      new BadRequestException('La anotación no puede estar vacía'),
    );
  });

  it('rejects an empty update without writing to the database', async () => {
    await expect(
      service.update('user-1', 'scene-1', 'annotation-1', {}),
    ).rejects.toThrow(new BadRequestException('No hay cambios para guardar'));

    expect(prisma.authorAnnotation.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.authorAnnotation.update).not.toHaveBeenCalled();
  });

  it('rejects an update when the annotation is not owned by the author', async () => {
    prisma.authorAnnotation.findFirst.mockResolvedValue(null);

    await expect(
      service.update('user-2', 'scene-1', 'annotation-1', {
        isResolved: true,
      }),
    ).rejects.toThrow(new NotFoundException('No se encontró la anotación'));

    expect(prisma.authorAnnotation.update).not.toHaveBeenCalled();
  });

  it('soft deletes the annotation while preserving its record', async () => {
    prisma.authorAnnotation.update.mockResolvedValue({ id: 'annotation-1' });

    await expect(
      service.remove('user-1', 'scene-1', 'annotation-1'),
    ).resolves.toBeUndefined();

    expect(prisma.authorAnnotation.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'annotation-1' },
        select: { id: true },
      }),
    );
    expect(
      prisma.authorAnnotation.update.mock.calls[0]?.[0].data['deletedAt'],
    ).toBeInstanceOf(Date);
  });

  it('rejects deletion when the annotation is outside the author’s project', async () => {
    prisma.authorAnnotation.findFirst.mockResolvedValue(null);

    await expect(
      service.remove('user-2', 'scene-1', 'annotation-1'),
    ).rejects.toThrow(new NotFoundException('No se encontró la anotación'));
    expect(prisma.authorAnnotation.update).not.toHaveBeenCalled();
  });
});
