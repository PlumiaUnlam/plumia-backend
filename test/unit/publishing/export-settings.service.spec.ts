import { Prisma } from '@prisma/client';
import { ExportSettingsService } from '../../../src/publishing/exports/export-settings.service';
import { DEFAULT_EXPORT_SETTINGS } from '../../../src/publishing/exports/export-settings.defaults';
import type { UpdateExportSettingsDto } from '../../../src/publishing/exports/dto/update-export-settings.dto';

describe('ExportSettingsService', () => {
  const prisma = {
    project: { findFirst: jest.fn() },
    exportSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };

  const service = new ExportSettingsService(prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects when the project is not owned by the user', async () => {
    prisma.project.findFirst.mockResolvedValue(null);

    await expect(service.getSettings('user-id', 'project-id')).rejects.toThrow(
      'Project not found',
    );
  });

  it('returns defaults when no settings row exists', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-id' });
    prisma.exportSettings.findUnique.mockResolvedValue(null);

    const result = await service.getSettings('user-id', 'project-id');

    expect(result).toEqual(DEFAULT_EXPORT_SETTINGS);
  });

  it('upserts settings scoped to the project', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'project-id' });
    const dto: UpdateExportSettingsDto = {
      margins: { topCm: 3, bottomCm: 2, leftCm: 1.5, rightCm: 1.5 },
      header: {
        text: '{{tituloLibro}}',
        alignment: 'center',
        pageNumber: { enabled: false, format: '' },
      },
      footer: null,
    };
    prisma.exportSettings.upsert.mockResolvedValue({
      marginTopCm: 3,
      marginBottomCm: 2,
      marginLeftCm: 1.5,
      marginRightCm: 1.5,
      header: dto.header,
      footer: null,
    });

    const result = await service.upsertSettings('user-id', 'project-id', dto);

    expect(prisma.exportSettings.upsert).toHaveBeenCalledWith({
      where: { projectId: 'project-id' },
      create: {
        projectId: 'project-id',
        marginTopCm: 3,
        marginBottomCm: 2,
        marginLeftCm: 1.5,
        marginRightCm: 1.5,
        header: dto.header,
        footer: Prisma.JsonNull,
      },
      update: {
        marginTopCm: 3,
        marginBottomCm: 2,
        marginLeftCm: 1.5,
        marginRightCm: 1.5,
        header: dto.header,
        footer: Prisma.JsonNull,
      },
    });
    expect(result.margins).toEqual({
      topCm: 3,
      bottomCm: 2,
      leftCm: 1.5,
      rightCm: 1.5,
    });
    expect(result.header).toEqual(dto.header);
  });

  it('getEffectiveConfig does not check ownership', async () => {
    prisma.exportSettings.findUnique.mockResolvedValue(null);

    const result = await service.getEffectiveConfig('project-id');

    expect(prisma.project.findFirst).not.toHaveBeenCalled();
    expect(result).toEqual(DEFAULT_EXPORT_SETTINGS);
  });
});
