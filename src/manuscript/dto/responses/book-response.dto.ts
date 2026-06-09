import type { BookRecord } from '../../ports/book-repository.port';

export class BookResponseDto {
  id!: string;
  projectId!: string;
  title!: string;
  sortKey!: string;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: BookRecord): BookResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      title: record.title,
      sortKey: record.sortKey,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
