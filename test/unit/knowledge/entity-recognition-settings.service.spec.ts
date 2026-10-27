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
        findUnique: jest.fn().mockResolvedValue({
          importantEntityNames: ['Mapa del Santuario'],
          ignoredEntityNames: [],
        }),
        upsert,
      },
      entityProposal: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new EntityRecognitionSettingsService(prisma as never);

    await expect(
      service.updateProjectSettings('user-1', 'project-1', [
        'Mapa del Santuario',
        'MAPA DEL SANTUARIO',
      ]),
    ).resolves.toEqual({
      importantEntityNames: ['Mapa del Santuario'],
      ignoredEntityNames: [],
      rejectedEntities: [],
    });

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: 'project-1' },
        create: {
          projectId: 'project-1',
          importantEntityNames: ['Mapa del Santuario'],
          ignoredEntityNames: [],
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

  it('returns rejected proposals and persists ignored names', async () => {
    const prisma = {
      project: {
        findFirst: jest.fn().mockResolvedValue({ id: 'project-1' }),
      },
      projectEntityRecognitionSettings: {
        findUnique: jest.fn().mockResolvedValue({
          importantEntityNames: ['Mara'],
          ignoredEntityNames: ['Una escalera'],
        }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
      entityProposal: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'proposal-1',
            entityId: null,
            proposedData: {
              canonicalName: 'La lampara',
              aliases: ['Lámpara antigua'],
              type: 'OBJECT',
            },
            createdAt: new Date('2026-10-25T00:00:00Z'),
            scene: { title: 'Capítulo 1' },
          },
        ]),
      },
    };
    const service = new EntityRecognitionSettingsService(prisma as never);

    await expect(
      service.updateProjectSettings(
        'user-1',
        'project-1',
        ['Mara'],
        ['Una escalera', 'UNA ESCALERA'],
      ),
    ).resolves.toMatchObject({
      importantEntityNames: ['Mara'],
      ignoredEntityNames: ['Una escalera'],
      rejectedEntities: [
        expect.objectContaining({ name: 'La lampara', type: 'OBJECT' }),
      ],
    });

    expect(prisma.projectEntityRecognitionSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          importantEntityNames: ['Mara'],
          ignoredEntityNames: ['Una escalera'],
        },
      }),
    );
  });
});
