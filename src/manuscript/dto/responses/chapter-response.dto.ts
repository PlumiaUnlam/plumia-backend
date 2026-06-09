import type { SceneStatus } from '@prisma/client';
import type { ChapterRecord } from '../../ports/chapter-repository.port';

export class ChapterResponseDto {
  id!: string;
  bookId!: string;
  title!: string;
  sortKey!: string;
  status!: SceneStatus;
  wordCount!: number;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: ChapterRecord): ChapterResponseDto {
    return {
      id: record.id,
      bookId: record.bookId,
      title: record.title,
      sortKey: record.sortKey,
      status: record.status,
      wordCount: record.wordCount,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
