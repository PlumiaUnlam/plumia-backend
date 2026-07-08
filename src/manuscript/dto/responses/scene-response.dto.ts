import type { SceneStatus } from '../../domain/scene-status';
import type { SceneRecord } from '../../ports/scene-repository.port';

export class SceneResponseDto {
  id!: string;
  chapterId!: string;
  title!: string | null;
  sortKey!: string;
  content!: unknown;
  wordCount!: number;
  povCharacterId!: string | null;
  status!: SceneStatus;
  order!: number;
  hash!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: SceneRecord): SceneResponseDto {
    return {
      id: record.id,
      chapterId: record.chapterId,
      title: record.title,
      sortKey: record.sortKey,
      content: record.content,
      wordCount: record.wordCount,
      povCharacterId: record.povCharacterId,
      status: record.status,
      order: record.order,
      hash: record.contentHash,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
