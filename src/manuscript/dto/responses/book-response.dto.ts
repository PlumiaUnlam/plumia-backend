import type { BookRecord } from '../../ports/book-repository.port';

export class BookResponseDto {
  id!: string;
  projectId!: string;
  title!: string;
  sortKey!: string;
  hasCover!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: BookRecord): BookResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      title: record.title,
      sortKey: record.sortKey,
      hasCover: record.coverStorageKey !== null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
