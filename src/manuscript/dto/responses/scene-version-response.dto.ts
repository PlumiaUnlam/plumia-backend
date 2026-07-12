import type {
  SceneVersionContentUpdateResult,
  SceneVersionRecord,
} from '../../ports/scene-repository.port';

export class SceneVersionResponseDto {
  id!: string;
  sceneId!: string;
  label!: string | null;
  content!: unknown;
  wordCount!: number;
  hash!: string | null;
  createdFromId!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: SceneVersionRecord): SceneVersionResponseDto {
    return {
      id: record.id,
      sceneId: record.sceneId,
      label: record.label,
      content: record.content,
      wordCount: record.wordCount,
      hash: record.contentHash,
      createdFromId: record.createdFromId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export class SceneVersionSummaryResponseDto {
  id!: string;
  sceneId!: string;
  label!: string | null;
  wordCount!: number;
  hash!: string | null;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: SceneVersionRecord): SceneVersionSummaryResponseDto {
    return {
      id: record.id,
      sceneId: record.sceneId,
      label: record.label,
      wordCount: record.wordCount,
      hash: record.contentHash,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export class SaveSceneVersionResultDto extends SceneVersionResponseDto {
  contentChanged!: boolean;

  static fromResult(
    result: SceneVersionContentUpdateResult,
  ): SaveSceneVersionResultDto {
    return {
      ...SceneVersionResponseDto.from(result.version),
      contentChanged: result.contentChanged,
    };
  }
}
