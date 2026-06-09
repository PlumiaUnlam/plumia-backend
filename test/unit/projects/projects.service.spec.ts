import { NotFoundException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  PROJECT_REPOSITORY,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectWithTreeRecord,
} from '../../../src/projects/ports/project-repository.port';
import { ProjectsService } from '../../../src/projects/projects.service';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let repository: jest.Mocked<ProjectRepository>;

  const now = new Date('2026-06-09T00:00:00.000Z');
  const project: ProjectRecord = {
    id: 'project-1',
    userId: 'user-1',
    title: 'Plum draft',
    description: 'A fantasy manuscript',
    genre: 'Fantasy',
    genreRules: { magic: 'finite' },
    wordCountTarget: 90000,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        {
          provide: PROJECT_REPOSITORY,
          useValue: {
            listByUser: jest.fn(),
            create: jest.fn(),
            findByIdForUser: jest.fn(),
            updateForUser: jest.fn(),
            softDeleteForUser: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(ProjectsService);
    repository = module.get(PROJECT_REPOSITORY);
  });

  it('lists projects through the repository port', async () => {
    repository.listByUser.mockResolvedValue([project]);

    const result = await service.listByUser('user-1');

    expect(result).toEqual([project]);
    expect(repository.listByUser).toHaveBeenCalledWith('user-1');
  });

  it('creates a project through the repository port without undefined fields', async () => {
    repository.create.mockResolvedValue(project);

    const result = await service.create('user-1', {
      title: 'Plum draft',
      genre: 'Fantasy',
    });

    expect(result).toEqual(project);
    expect(repository.create).toHaveBeenCalledWith({
      userId: 'user-1',
      title: 'Plum draft',
      genre: 'Fantasy',
    });
  });

  it('returns a project tree when found', async () => {
    const projectTree: ProjectWithTreeRecord = { ...project, books: [] };
    repository.findByIdForUser.mockResolvedValue(projectTree);

    const result = await service.getById('user-1', 'project-1');

    expect(result).toEqual(projectTree);
    expect(repository.findByIdForUser).toHaveBeenCalledWith(
      'user-1',
      'project-1',
    );
  });

  it('throws NotFoundException when the project tree is missing', async () => {
    repository.findByIdForUser.mockResolvedValue(null);

    await expect(service.getById('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
  });

  it('updates a project through the repository port', async () => {
    repository.updateForUser.mockResolvedValue(project);

    const result = await service.update('user-1', 'project-1', {
      title: 'New title',
      status: 'active',
    });

    expect(result).toEqual(project);
    expect(repository.updateForUser).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      { title: 'New title', status: 'active' },
    );
  });

  it('throws NotFoundException when updating a missing project', async () => {
    repository.updateForUser.mockResolvedValue(null);

    await expect(
      service.update('user-1', 'missing', { title: 'New title' }),
    ).rejects.toThrow(new NotFoundException('Project not found'));
  });

  it('soft deletes a project through the repository port', async () => {
    repository.softDeleteForUser.mockResolvedValue(project);

    const result = await service.remove('user-1', 'project-1');

    expect(result).toEqual(project);
    expect(repository.softDeleteForUser).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      expect.any(Date),
    );
  });

  it('throws NotFoundException when deleting a missing project', async () => {
    repository.softDeleteForUser.mockResolvedValue(null);

    await expect(service.remove('user-1', 'missing')).rejects.toThrow(
      new NotFoundException('Project not found'),
    );
  });
});
