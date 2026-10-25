import { NotFoundException } from '@nestjs/common';
import { EntityRecognitionSettingsService } from '../../../src/knowledge/services/entity-recognition-settings.service';

describe('EntityRecognitionSettingsService', () => {
  it('normalizes duplicate project interest names without fuzzy matching', async () => {
    const upsert = jest.fn().mockResolvedValue({
      importantEntityNames: ['Mapa del Santuario'],
    });
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
      },
      projectEntityRecognitionSettings: {
        findUnique: jest.fn(),
        upsert,
      },
    };
    const service = new EntityRecognitionSettingsService(prisma as never);

    await expect(
      service.updateProjectSettings('user-1', 'project-1', [
        'Mapa del Santuario',
        'MAPA DEL SANTUARIO',
      ]),
    ).resolves.toEqual({ importantEntityNames: ['Mapa del Santuario'] });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1' },
        create: {
          projectId: 'project-1',
          importantEntityNames: ['Mapa del Santuario'],
        },
      }),
    );
  });

  it('rejects access to a project owned by another user', async () => {
    const prisma = {
      project: { findFirst: jest.fn().mockResolvedValue(null) },
      projectEntityRecognitionSettings: { findUnique: jest.fn() },
    };
    const service = new EntityRecognitionSettingsService(prisma as never);

    await expect(
      service.getProjectSettings('other-user', 'project-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
