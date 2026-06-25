import { Test, type TestingModule } from '@nestjs/testing';
import {
  type ProjectRecord,
  type ProjectWithTreeRecord,
} from '../../../src/manuscript/ports/project-repository.port';
import { ProjectsController } from '../../../src/manuscript/controllers/projects.controller';
import { ProjectStatus } from '../../../src/manuscript/domain/project-status';
import { ProjectService } from '../../../src/manuscript/services/project.service';

describe('ProjectsController', () => {
  let controller: ProjectsController;
  let service: jest.Mocked<ProjectService>;

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
    status: ProjectStatus.DRAFT,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ProjectsController],
      providers: [
        {
          provide: ProjectService,
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
    service = module.get(ProjectService);
  });

  it('lists projects for the authenticated user', async () => {
    service.listByUser.mockResolvedValue([project]);

    const result = await controller.listProjects(req);

    expect(result).toEqual([
      {
        id: project.id,
        userId: project.userId,
        title: project.title,
        description: project.description,
        genre: project.genre,
        genreRules: project.genreRules,
        wordCountTarget: project.wordCountTarget,
        status: project.status,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      },
    ]);
    expect(service.listByUser).toHaveBeenCalledWith('user-1');
  });

  it('creates a project for the authenticated user', async () => {
    const dto = { title: 'Plum draft', genre: 'Fantasy' };
    service.create.mockResolvedValue(project);

    const result = await controller.createProject(req, dto);

    expect(result).not.toHaveProperty('deletedAt');
    expect(result).toMatchObject({ id: project.id, title: project.title });
    expect(service.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('returns a project tree for the authenticated user', async () => {
    const projectTree: ProjectWithTreeRecord = {
      ...project,
      books: [
        {
          id: 'book-1',
          title: 'Book one',
          sortKey: '001',
          chapters: [
            {
              id: 'chapter-1',
              title: 'Chapter one',
              sortKey: '001',
              scenes: [
                {
                  id: 'scene-1',
                  title: 'Opening',
                  sortKey: '001',
                  wordCount: 1200,
                  order: 1,
                },
              ],
            },
          ],
        },
      ],
    };
    service.getById.mockResolvedValue(projectTree);

    const result = await controller.getProjectById(req, 'project-1');

    expect(result).not.toHaveProperty('deletedAt');
    expect(result.books).toEqual(projectTree.books);
    expect(service.getById).toHaveBeenCalledWith('user-1', 'project-1');
  });

  it('updates a project for the authenticated user', async () => {
    const dto = { title: 'New title' };
    service.update.mockResolvedValue(project);

    const result = await controller.updateProject(req, 'project-1', dto);

    expect(result).not.toHaveProperty('deletedAt');
    expect(result).toMatchObject({ id: project.id, title: project.title });
    expect(service.update).toHaveBeenCalledWith('user-1', 'project-1', dto);
  });

  it('removes a project for the authenticated user', async () => {
    service.remove.mockResolvedValue(project);

    const result = await controller.removeProject(req, 'project-1');

    expect(result).not.toHaveProperty('deletedAt');
    expect(result).toMatchObject({ id: project.id, title: project.title });
    expect(service.remove).toHaveBeenCalledWith('user-1', 'project-1');
  });
});
