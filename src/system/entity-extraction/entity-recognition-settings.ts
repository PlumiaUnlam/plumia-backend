import { EntityType } from '../../knowledge/domain/entity-type';

export type EntityRecognitionThresholds = Record<EntityType, number>;

export const DEFAULT_ENTITY_RECOGNITION_THRESHOLDS: EntityRecognitionThresholds =
  {
    [EntityType.CHARACTER]: 0.55,
    [EntityType.LOCATION]: 0.65,
    [EntityType.OBJECT]: 0.85,
    [EntityType.ORGANIZATION]: 0.7,
    [EntityType.EVENT]: 0.75,
    [EntityType.CONCEPT]: 0.8,
  };

export function normalizeEntityRecognitionThresholds(
  value: unknown,
): EntityRecognitionThresholds {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    Object.values(EntityType).map((type) => {
      const candidate = source[type];
      return [
        type,
        typeof candidate === 'number' && Number.isFinite(candidate)
          ? Math.min(1, Math.max(0, candidate))
          : DEFAULT_ENTITY_RECOGNITION_THRESHOLDS[type],
      ];
    }),
  ) as EntityRecognitionThresholds;
}

export function normalizeEntityRecognitionName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
