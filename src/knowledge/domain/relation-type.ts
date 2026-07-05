export enum RelationType {
  ALLY = 'ALLY',
  ENEMY = 'ENEMY',
  FAMILY = 'FAMILY',
  ROMANTIC = 'ROMANTIC',
  MENTOR = 'MENTOR',
  RIVAL = 'RIVAL',
  MEMBER_OF = 'MEMBER_OF',
  LOCATED_IN = 'LOCATED_IN',
  OWNS = 'OWNS',
  KNOWS = 'KNOWS',
}

export function toRelationType(type: string): RelationType {
  if (Object.values(RelationType).includes(type as RelationType)) {
    return type as RelationType;
  }

  return RelationType.KNOWS;
}
