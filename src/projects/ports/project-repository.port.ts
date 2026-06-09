export const PROJECT_REPOSITORY = Symbol('PROJECT_REPOSITORY');

export interface ProjectRecord {
  id: string;
  userId: string;
  title: string;
  description: string | null;
  genre: string | null;
  genreRules: unknown;
  wordCountTarget: number | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectSceneRecord {
  id: string;
  chapterId: string;
  title: string | null;
  sortKey: string;
  content: unknown;
  contentHash: string | null;
  wordCount: number;
  povCharacterId: string | null;
  status: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface ProjectChapterRecord {
  id: string;
  bookId: string;
  title: string;
  sortKey: string;
  status: string;
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  scenes: ProjectSceneRecord[];
}

export interface ProjectBookRecord {
  id: string;
  projectId: string;
  title: string;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
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
  status?: string;
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
