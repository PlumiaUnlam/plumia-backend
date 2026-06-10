import type { SceneStatus } from '../domain/scene-status';

export const SCENE_REPOSITORY = Symbol('SCENE_REPOSITORY');

export interface SceneRecord {
  id: string;
  chapterId: string;
  title: string | null;
  sortKey: string;
  content: unknown;
  contentHash: string | null;
  wordCount: number;
  povCharacterId: string | null;
  status: SceneStatus;
  order: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CreateSceneData {
  chapterId: string;
  title?: string;
  sortKey: string;
  content?: Record<string, unknown>;
  wordCount?: number;
  status?: SceneStatus;
  order?: number;
}

export interface UpdateSceneData {
  title?: string;
  sortKey?: string;
  status?: SceneStatus;
  order?: number;
}

export interface UpdateSceneContentData {
  content: Record<string, unknown>;
  wordCount?: number;
}

export interface SceneRepository {
  createForUser(
    userId: string,
    data: CreateSceneData,
  ): Promise<SceneRecord | null>;
  findByIdForUser(userId: string, sceneId: string): Promise<SceneRecord | null>;
  updateForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneData,
  ): Promise<SceneRecord | null>;
  updateContentForUser(
    userId: string,
    sceneId: string,
    data: UpdateSceneContentData,
  ): Promise<SceneRecord | null>;
  softDeleteForUser(
    userId: string,
    sceneId: string,
    deletedAt: Date,
  ): Promise<SceneRecord | null>;
}
