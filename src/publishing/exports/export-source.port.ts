import type { Prisma } from '@prisma/client';

export const EXPORT_SOURCE = Symbol('EXPORT_SOURCE');

export type ExportSourceRecord = {
  id: string;
  title: string;
  books: Array<{
    title: string;
    chapters: Array<{
      title: string;
      scenes: Array<{
        id: string;
        title: string | null;
        content: Prisma.JsonValue | null;
      }>;
    }>;
  }>;
};

export interface ExportSourceRepository {
  findByIdForUser(
    userId: string,
    projectId: string,
  ): Promise<ExportSourceRecord | null>;
}
