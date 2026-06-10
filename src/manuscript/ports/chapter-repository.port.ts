import type { ChapterStatus } from '../domain/scene-status';

export const CHAPTER_REPOSITORY = Symbol('CHAPTER_REPOSITORY');

export interface ChapterRecord {
  id: string;
  bookId: string;
  title: string;
  sortKey: string;
  status: ChapterStatus;
  wordCount: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateChapterData {
  bookId: string;
  title: string;
  sortKey: string;
  status?: ChapterStatus;
}

export interface UpdateChapterData {
  title?: string;
  sortKey?: string;
  status?: ChapterStatus;
}

export interface ChapterRepository {
  createForUser(
    userId: string,
    data: CreateChapterData,
  ): Promise<ChapterRecord | null>;
  findByIdForUser(
    userId: string,
    chapterId: string,
  ): Promise<ChapterRecord | null>;
  updateForUser(
    userId: string,
    chapterId: string,
    data: UpdateChapterData,
  ): Promise<ChapterRecord | null>;
  softDeleteForUser(
    userId: string,
    chapterId: string,
    deletedAt: Date,
  ): Promise<ChapterRecord | null>;
}
