import type { Scene } from '@prisma/client';
import { toSceneStatus } from '../domain/scene-status';
import type {
  SceneRecord,
  SceneVersionRecord,
} from '../ports/scene-repository.port';

export interface SceneVersionRow {
  id: string;
  sceneId: string;
  label: string | null;
  content: Prisma.JsonValue | null;
  contentHash: string | null;
  wordCount: number;
  createdFromId: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}


export function toSceneRecord(scene: Scene): SceneRecord {
    return {
      id: scene.id,
      chapterId: scene.chapterId,
      title: scene.title,
      sortKey: scene.sortKey,
      content: scene.content,
      contentHash: scene.contentHash,
      wordCount: scene.wordCount,
      povCharacterId: scene.povCharacterId,
      status: toSceneStatus(scene.status),
      order: scene.order,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
      deletedAt: scene.deletedAt,
    };
  }

export function toSceneVersionRecord(version: SceneVersionRow): SceneVersionRecord {
    return {
      id: version.id,
      sceneId: version.sceneId,
      label: version.label,
      content: version.content,
      contentHash: version.contentHash,
      wordCount: version.wordCount,
      createdFromId: version.createdFromId,
      createdAt: version.createdAt,
      updatedAt: version.updatedAt,
      deletedAt: version.deletedAt,
    };
  }
