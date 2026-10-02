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
        update: jest.fn<Promise<unknown>, [AnnotationUpdateArgs]>(),
      },
    };
    service = new AuthorAnnotationsService(prisma as unknown as PrismaService);
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
});
