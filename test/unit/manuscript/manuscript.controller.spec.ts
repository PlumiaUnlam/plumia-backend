import { Test, type TestingModule } from '@nestjs/testing';
import {
  type ProjectRecord,
  type ProjectWithTreeRecord,
} from '../../../src/manuscript/ports/project-repository.port';
import { ManuscriptController } from '../../../src/manuscript/manuscript.controller';
import { ProjectService } from '../../../src/manuscript/services/project.service';

describe('ManuscriptController', () => {
  let controller: ManuscriptController;
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
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ManuscriptController],
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

    controller = module.get(ManuscriptController);
    service = module.get(ProjectService);
  });

  it('lists projects for the authenticated user', async () => {
    service.listByUser.mockResolvedValue([project]);

    const result = await controller.listProjects(req);

    expect(result).toEqual([project]);
    expect(service.listByUser).toHaveBeenCalledWith('user-1');
  });

  it('creates a project for the authenticated user', async () => {
    const dto = { title: 'Plum draft', genre: 'Fantasy' };
    service.create.mockResolvedValue(project);

    const result = await controller.createProject(req, dto);

    expect(result).toEqual(project);
    expect(service.create).toHaveBeenCalledWith('user-1', dto);
  });

  it('returns a project tree for the authenticated user', async () => {
    const projectTree: ProjectWithTreeRecord = {
      ...project,
      books: [
        {
          id: 'book-1',
          title: 'Book one',
          chapters: [
            {
              id: 'chapter-1',
              title: 'Chapter one',
              scenes: [
                {
                  id: 'scene-1',
                  title: 'Opening',
                  wordCount: 1200,
                },
              ],
            },
          ],
        },
      ],
    };
    service.getById.mockResolvedValue(projectTree);

    const result = await controller.getProjectById(req, 'project-1');

    expect(result).toEqual(projectTree);
    expect(service.getById).toHaveBeenCalledWith('user-1', 'project-1');
  });

  it('updates a project for the authenticated user', async () => {
    const dto = { title: 'New title' };
    service.update.mockResolvedValue(project);

    const result = await controller.updateProject(req, 'project-1', dto);

    expect(result).toEqual(project);
    expect(service.update).toHaveBeenCalledWith('user-1', 'project-1', dto);
  });

  it('removes a project for the authenticated user', async () => {
    service.remove.mockResolvedValue(project);

    const result = await controller.removeProject(req, 'project-1');

    expect(result).toEqual(project);
    expect(service.remove).toHaveBeenCalledWith('user-1', 'project-1');
  });
});
