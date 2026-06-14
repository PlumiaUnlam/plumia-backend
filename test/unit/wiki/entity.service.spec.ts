import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { WikiEntityType } from '../../../src/wiki/domain/wiki-entity-type';
import {
  ENTITY_REPOSITORY,
  type EntityRecord,
  type EntityRepository,
} from '../../../src/wiki/ports/entity-repository.port';
import { EntityService } from '../../../src/wiki/services/entity.service';

describe('EntityService', () => {
  let service: EntityService;
  let repository: jest.Mocked<EntityRepository>;

  const now = new Date('2026-06-11T00:00:00.000Z');
  const entity: EntityRecord = {
    id: 'entity-1',
    projectId: 'project-1',
    canonicalName: 'Maren Solis',
    aliases: ['Maren'],
    type: WikiEntityType.CHARACTER,
    description: 'Investigadora del Archivo Municipal.',
    attributes: { status: 'alive' },
    imageUrl: null,
    confidenceScore: '1',
    source: 'author_manual',
    userLockedFields: ['canonicalName', 'type'],
    isActive: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EntityService,
        {
          provide: ENTITY_REPOSITORY,
          useValue: {
            listByProjectForUser: jest.fn(),
            createForUser: jest.fn(),
            findByIdForUser: jest.fn(),
            updateForUser: jest.fn(),
            softDeleteForUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(EntityService);
    repository = module.get(ENTITY_REPOSITORY);
  });

  it('lists and creates entities through the repository port', async () => {
    repository.listByProjectForUser.mockResolvedValue([entity]);
    repository.createForUser.mockResolvedValue(entity);

    await expect(
      service.list('user-1', 'project-1', {
        type: WikiEntityType.CHARACTER,
        search: 'Maren',
      }),
    ).resolves.toEqual([entity]);
    await expect(
      service.create('user-1', {
        projectId: 'project-1',
        canonicalName: entity.canonicalName,
        type: entity.type,
        aliases: entity.aliases,
      }),
    ).resolves.toEqual(entity);

    expect(repository.listByProjectForUser).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      { type: WikiEntityType.CHARACTER, search: 'Maren' },
    );
    expect(repository.createForUser).toHaveBeenCalledWith('user-1', {
      projectId: 'project-1',
      canonicalName: entity.canonicalName,
      type: entity.type,
      aliases: entity.aliases,
    });
  });

  it('throws clear NotFoundException messages for missing records', async () => {
    repository.listByProjectForUser.mockResolvedValue(null);
    repository.createForUser.mockResolvedValue(null);
    repository.findByIdForUser.mockResolvedValue(null);
    repository.updateForUser.mockResolvedValue(null);
    repository.softDeleteForUser.mockResolvedValue(null);

    await expect(service.list('user-1', 'missing', {})).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
    await expect(
      service.create('user-1', {
        projectId: 'missing',
        canonicalName: 'Archivo Municipal',
        type: WikiEntityType.FACTION,
      }),
    ).rejects.toThrow(new NotFoundException('Project not found'));
    await expect(service.getById('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
    await expect(
      service.update('user-1', 'missing', { description: 'Nueva descripcion' }),
    ).rejects.toThrow(new NotFoundException('Entity not found'));
    await expect(service.remove('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Entity not found'),
    );
  });
});
