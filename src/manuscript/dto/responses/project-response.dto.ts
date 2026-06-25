import type { ProjectStatus } from '../../domain/project-status';
import type {
  ProjectRecord,
  ProjectWithTreeRecord,
} from '../../ports/project-repository.port';

export class ProjectSceneResponseDto {
  id!: string;
  title!: string | null;
  sortKey!: string;
  wordCount!: number;
  order!: number;
}

export class ProjectChapterResponseDto {
  id!: string;
  title!: string;
  sortKey!: string;
  scenes!: ProjectSceneResponseDto[];
}

export class ProjectBookResponseDto {
  id!: string;
  title!: string;
  sortKey!: string;
  chapters!: ProjectChapterResponseDto[];
}

export class ProjectResponseDto {
  id!: string;
  userId!: string;
  title!: string;
  description!: string | null;
  genre!: string | null;
  genreRules!: unknown;
  wordCountTarget!: number | null;
  status!: ProjectStatus;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: ProjectRecord): ProjectResponseDto {
    return {
      id: record.id,
      userId: record.userId,
      title: record.title,
      description: record.description,
      genre: record.genre,
      genreRules: record.genreRules,
      wordCountTarget: record.wordCountTarget,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export class ProjectWithTreeResponseDto extends ProjectResponseDto {
  books!: ProjectBookResponseDto[];

  static from(record: ProjectWithTreeRecord): ProjectWithTreeResponseDto {
    return {
      ...ProjectResponseDto.from(record),
      books: record.books.map((book) => ({
        id: book.id,
        title: book.title,
        sortKey: book.sortKey,
        chapters: book.chapters.map((chapter) => ({
          id: chapter.id,
          title: chapter.title,
          sortKey: chapter.sortKey,
          scenes: chapter.scenes.map((scene) => ({
            id: scene.id,
            title: scene.title,
            sortKey: scene.sortKey,
            wordCount: scene.wordCount,
            order: scene.order,
          })),
        })),
      })),
    };
  }
}
