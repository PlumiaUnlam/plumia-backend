export interface EntityStateHistorySceneDto {
  id: string;
  title: string | null;
  chapterTitle: string;
  bookTitle: string;
}

export class EntityStateHistoryResponseDto {
  id!: string;
  entityId!: string;
  entityName!: string;
  attributeKey!: string;
  fromValue!: string | null;
  toValue!: string | null;
  validFromScene!: EntityStateHistorySceneDto;
  validToScene!: EntityStateHistorySceneDto | null;
  narrativeOrder!: number | null;
  source!: string;
  createdAt!: Date;
}
