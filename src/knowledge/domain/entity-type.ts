export enum EntityType {
  CHARACTER = 'CHARACTER',
  LOCATION = 'LOCATION',
  OBJECT = 'OBJECT',
  ORGANIZATION = 'ORGANIZATION',
  EVENT = 'EVENT',
  CONCEPT = 'CONCEPT',
}

export function toEntityType(type: string): EntityType {
  if (Object.values(EntityType).includes(type as EntityType)) {
    return type as EntityType;
  }

  return EntityType.CHARACTER;
}
