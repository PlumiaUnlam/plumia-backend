export const BOOK_REPOSITORY = Symbol('BOOK_REPOSITORY');

export interface BookRecord {
  id: string;
  projectId: string;
  title: string;
  sortKey: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateBookData {
  projectId: string;
  title: string;
  sortKey: string;
}

export interface UpdateBookData {
  title?: string;
  sortKey?: string;
}

export interface BookRepository {
  createForUser(
    userId: string,
    data: CreateBookData,
  ): Promise<BookRecord | null>;
  findByIdForUser(userId: string, bookId: string): Promise<BookRecord | null>;
  updateForUser(
    userId: string,
    bookId: string,
    data: UpdateBookData,
  ): Promise<BookRecord | null>;
  softDeleteForUser(
    userId: string,
    bookId: string,
    deletedAt: Date,
  ): Promise<BookRecord | null>;
}
