import { AuthorAnnotationsController } from '../../../src/manuscript/controllers/author-annotations.controller';
import type { AuthenticatedRequest } from '../../../src/manuscript/controllers/authenticated-request';
import type { AuthorAnnotationsService } from '../../../src/manuscript/services/author-annotations.service';

describe('AuthorAnnotationsController', () => {
  it('routes list, create, update, and delete through the authenticated author', async () => {
    const service = {
      list: jest.fn().mockResolvedValue([{ id: 'annotation-1' }]),
      create: jest.fn().mockResolvedValue({ id: 'annotation-1' }),
      update: jest.fn().mockResolvedValue({ id: 'annotation-1' }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new AuthorAnnotationsController(
      service as unknown as AuthorAnnotationsService,
    );
    const request = { user: { id: 'author-1' } } as AuthenticatedRequest;
    const createDto = { body: 'A note' };
    const updateDto = { isResolved: true };

    await expect(controller.list(request, 'scene-1')).resolves.toEqual([
      { id: 'annotation-1' },
    ]);
    await expect(
      controller.create(request, 'scene-1', createDto),
    ).resolves.toEqual({ id: 'annotation-1' });
    await expect(
      controller.update(request, 'scene-1', 'annotation-1', updateDto),
    ).resolves.toEqual({ id: 'annotation-1' });
    await expect(
      controller.remove(request, 'scene-1', 'annotation-1'),
    ).resolves.toBeUndefined();

    expect(service.list).toHaveBeenCalledWith('author-1', 'scene-1');
    expect(service.create).toHaveBeenCalledWith(
      'author-1',
      'scene-1',
      createDto,
    );
    expect(service.update).toHaveBeenCalledWith(
      'author-1',
      'scene-1',
      'annotation-1',
      updateDto,
    );
    expect(service.remove).toHaveBeenCalledWith(
      'author-1',
      'scene-1',
      'annotation-1',
    );
  });
});
