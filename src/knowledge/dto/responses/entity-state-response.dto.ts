export class EntityStateResponseDto {
  id!: string;
  entityId!: string;
  attributeKey!: string;
  fromValue!: string | null;
  toValue!: string | null;
  validFromSceneId!: string;
  validToSceneId!: string | null;
  source!: string;
  createdAt!: Date;
}
