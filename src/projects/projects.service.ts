import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  PROJECT_REPOSITORY,
  type CreateProjectData,
  type ProjectRecord,
  type ProjectRepository,
  type ProjectWithTreeRecord,
} from './ports/project-repository.port';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY)
    private readonly projectRepository: ProjectRepository,
  ) {}

  listByUser(userId: string): Promise<ProjectRecord[]> {
    return this.projectRepository.listByUser(userId);
  }

  create(userId: string, dto: CreateProjectDto): Promise<ProjectRecord> {
    const data: CreateProjectData = {
      userId,
      title: dto.title,
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.genre !== undefined ? { genre: dto.genre } : {}),
      ...(dto.genreRules !== undefined ? { genreRules: dto.genreRules } : {}),
      ...(dto.wordCountTarget !== undefined
        ? { wordCountTarget: dto.wordCountTarget }
        : {}),
    };

    return this.projectRepository.create(data);
  }

  async getById(userId: string, id: string): Promise<ProjectWithTreeRecord> {
    const project = await this.projectRepository.findByIdForUser(userId, id);

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectRecord> {
    const project = await this.projectRepository.updateForUser(userId, id, dto);

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }

  async remove(userId: string, id: string): Promise<ProjectRecord> {
    const project = await this.projectRepository.softDeleteForUser(
      userId,
      id,
      new Date(),
    );

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    return project;
  }
}
