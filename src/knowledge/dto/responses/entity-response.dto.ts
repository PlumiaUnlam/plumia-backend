import type { EntityType } from '../../domain/entity-type';
import type { EntityRecord } from '../../ports/entity-repository.port';

export class EntityResponseDto {
  id!: string;
  projectId!: string;
  canonicalName!: string;
  aliases!: string[];
  type!: EntityType;
  description!: string | null;
  attributes!: unknown;
  imageUrl!: string | null;
  isActive!: boolean;
  createdAt!: Date;
  updatedAt!: Date;

  static from(record: EntityRecord): EntityResponseDto {
    return {
      id: record.id,
      projectId: record.projectId,
      canonicalName: record.canonicalName,
      aliases: record.aliases,
      type: record.type,
      description: record.description,
      attributes: record.attributes,
      imageUrl: record.imageUrl,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}
