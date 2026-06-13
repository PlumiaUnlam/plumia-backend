import type {
  EntityDetailRecord,
  EntityRecord,
} from '../../ports/entity-repository.port';
import type { WikiEntityType } from '../../domain/wiki-entity-type';

export class EntityResponseDto {
  id!: string;
  projectId!: string;
  canonicalName!: string;
  aliases!: string[];
  type!: WikiEntityType;
  description!: string | null;
  attributes!: unknown;
  imageUrl!: string | null;
  confidenceScore!: string;
  source!: string;
  userLockedFields!: string[];
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
      confidenceScore: record.confidenceScore,
      source: record.source,
      userLockedFields: record.userLockedFields,
      isActive: record.isActive,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export class EntityDetailResponseDto extends EntityResponseDto {
  facts!: unknown[];
  states!: unknown[];
  relationships!: unknown[];
  generatedImages!: unknown[];

  static from(record: EntityDetailRecord): EntityDetailResponseDto {
    return {
      ...EntityResponseDto.from(record),
      facts: record.facts,
      states: record.states,
      relationships: record.relationships,
      generatedImages: record.generatedImages,
    };
  }
}
