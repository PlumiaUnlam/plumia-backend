import { Test, type TestingModule } from '@nestjs/testing';
import {
  type ProjectRecord,
  type ProjectWithTreeRecord,
} from '../../../src/projects/ports/project-repository.port';
import { ProjectsController } from '../../../src/projects/projects.controller';
import { ProjectsService } from '../../../src/projects/projects.service';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: jest.Mocked<ProjectsService>;

  const req = { user: { id: 'user-1', email: 'author@plumia.test' } };
  const now = new Date('2026-06-09T00:00:00.000Z');
  const project: ProjectRecord = {
    id: 'project-1',
    userId: 'user-1',
    title: 'Plum draft',
    description: null,
    genre: 'Fantasy',
    genreRules: null,
    wordCountTarget: null,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectsService,
          useValue: {
            listByUser: jest.fn(),
            create: jest.fn(),
            getById: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get(ProjectsController);
    service = module.get(ProjectsService);
  });

  it('lists projects for the authenticated user', async () => {
    service.listByUser.mockResolvedValue([project]);

    const result = await controller.list(req);

    expect(result).toEqual([project]);
    expect(service.listByUser).toHaveBeenCalledWith('user-1');
  });

  it('creates a project for the authenticated user', async () => {
    const dto = { title: 'Plum draft', genre: 'Fantasy' };
    service.create.mockResolvedValue(project);

    const result = await controller.create(req, dto);

    expect(result).toEqual(project);
    expect(service.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('returns a project tree for the authenticated user', async () => {
    const projectTree: ProjectWithTreeRecord = { ...project, books: [] };
    service.getById.mockResolvedValue(projectTree);

    const result = await controller.getById(req, 'project-1');

    expect(result).toEqual(projectTree);
    expect(service.getById).toHaveBeenCalledWith('user-1', 'project-1');
  });

  it('updates a project for the authenticated user', async () => {
    const dto = { title: 'New title' };
    service.update.mockResolvedValue(project);

    const result = await controller.update(req, 'project-1', dto);

    expect(result).toEqual(project);
    expect(service.update).toHaveBeenCalledWith('user-1', 'project-1', dto);
  });

  it('removes a project for the authenticated user', async () => {
    service.remove.mockResolvedValue(project);

    const result = await controller.remove(req, 'project-1');

    expect(result).toEqual(project);
    expect(service.remove).toHaveBeenCalledWith('user-1', 'project-1');
  });
});
