export const STORAGE_RESOURCE_AUTHORIZATION = Symbol(
  'STORAGE_RESOURCE_AUTHORIZATION',
);

export interface StorageResourceAuthorization {
  hasStoryboardCardAccess(userId: string, cardId: string): Promise<boolean>;
}
