import type { ProjectStatus } from '../domain/project-status';

export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface ProjectRecord {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  genre: string | null;
  genreRules: unknown;
  wordCountTarget: number | null;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectSceneRecord {
  id: string;
  title: string | null;
  wordCount: number;
}

export interface ProjectChapterRecord {
  id: string;
  title: string;
  scenes: ProjectSceneRecord[];
}

export interface ProjectBookRecord {
  id: string;
  title: string;
  chapters: ProjectChapterRecord[];
}

export interface ProjectWithTreeRecord extends ProjectRecord {
  books: ProjectBookRecord[];
}

export interface CreateProjectData {
  userId: string;
  title: string;
  description?: string;
  genre?: string;
  genreRules?: Record<string, unknown>;
  wordCountTarget?: number;
}

export interface UpdateProjectData {
  title?: string;
  description?: string;
  genre?: string;
  genreRules?: Record<string, unknown>;
  wordCountTarget?: number;
  status?: ProjectStatus;
}

export interface ProjectRepository {
  listByUser(userId: string): Promise<ProjectRecord[]>;
  create(data: CreateProjectData): Promise<ProjectRecord>;
  findByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ProjectWithTreeRecord | null>;
  updateForUser(
    userId: string,
    projectId: string,
    data: UpdateProjectData,
  ): Promise<ProjectRecord | null>;
  softDeleteForUser(
    userId: string,
    projectId: string,
    deletedAt: Date,
  ): Promise<ProjectRecord | null>;
}
