import type { Prisma } from '@prisma/client';

export const EXPORT_SOURCE = Symbol('EXPORT_SOURCE');

/** Contenido del libro que se convierte en el documento exportable. */
export interface ExportContentSource {
  id: string;
  title: string;
  chapters: Array<{
    id: string;
    title: string;
    scenes: Array<{
      id: string;
      title: string | null;
      content: Prisma.JsonValue | null;
    }>;
  }>;
}

export interface ExportSourceRecord extends ExportContentSource {
  coverStorageKey: string | null;
  project: {
    user: {
      name: string;
      lastname: string;
      displayName: string | null;
    };
  };
}

export interface ExportSourceRepository {
  findByIdForUser(
    userId: string,
    bookId: string,
  ): Promise<ExportSourceRecord | null>;
}
