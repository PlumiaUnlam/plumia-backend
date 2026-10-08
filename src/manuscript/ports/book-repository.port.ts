export const BOOK_REPOSITORY = Symbol('BOOK_REPOSITORY');

export interface BookRecord {
  id: string;
  projectId: string;
  title: string;
  sortKey: string;
  coverStorageKey: string | null;
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
  /**
   * Reemplaza la portada del libro. Devuelve la clave anterior (para borrar el
   * objeto viejo) o `null` si el libro no existe o no es del usuario.
   */
  setCoverForUser(
    userId: string,
    bookId: string,
    coverStorageKey: string | null,
  ): Promise<{ previousCoverStorageKey: string | null } | null>;
  softDeleteForUser(
    userId: string,
    bookId: string,
    deletedAt: Date,
  ): Promise<BookRecord | null>;
}
