export enum WikiEntityType {
  CHARACTER = 'character',
  LOCATION = 'location',
  OBJECT = 'object',
  FACTION = 'faction',
  EVENT = 'event',
  CONCEPT = 'concept',
}

const prismaEntityTypeByWikiType: Record<WikiEntityType, string> = {
  [WikiEntityType.CHARACTER]: 'CHARACTER',
  [WikiEntityType.LOCATION]: 'LOCATION',
  [WikiEntityType.OBJECT]: 'OBJECT',
  [WikiEntityType.FACTION]: 'ORGANIZATION',
  [WikiEntityType.EVENT]: 'EVENT',
  [WikiEntityType.CONCEPT]: 'CONCEPT',
};

const wikiEntityTypeByPrismaType = Object.fromEntries(
  Object.entries(prismaEntityTypeByWikiType).map(([wikiType, prismaType]) => [
    prismaType,
    wikiType,
  ]),
) as Record<string, WikiEntityType>;

export function toPrismaEntityType(type: WikiEntityType): string {
  return prismaEntityTypeByWikiType[type];
}

export function toWikiEntityType(type: string): WikiEntityType {
  const wikiType = wikiEntityTypeByPrismaType[type];

  if (!wikiType) {
    throw new Error(`Unsupported entity type: ${type}`);
  }

  return wikiType;
}
