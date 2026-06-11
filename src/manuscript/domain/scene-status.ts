export enum SceneStatus {
  DRAFT = 'DRAFT',
  IN_PROGRESS = 'IN_PROGRESS',
  REVIEW = 'REVIEW',
  DONE = 'DONE',
}

export type ChapterStatus = SceneStatus;

export function toSceneStatus(status: string): SceneStatus {
  if (Object.values(SceneStatus).includes(status as SceneStatus)) {
    return status as SceneStatus;
  }

  return SceneStatus.DRAFT;
}
