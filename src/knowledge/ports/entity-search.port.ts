// Port (interfaz de dominio) para busqueda fuzzy de entidades por nombre.
// El dominio depende de ESTA abstraccion, nunca de pg_trgm/Postgres.
// Token de inyeccion para el adapter concreto.
export const ENTITY_SEARCH = Symbol('ENTITY_SEARCH');

export interface EntitySearchInput {
  projectId: string;
  query: string;
  limit: number;
  // Umbral de similaridad [0..1]. Default razonable: 0.3.
  threshold?: number;
}

export interface EntitySearchResult {
  entityId: string;
  canonicalName: string;
  // Similaridad [0..1] (mayor = mejor match).
  score: number;
}

export interface EntitySearch {
  searchByName(input: EntitySearchInput): Promise<EntitySearchResult[]>;
}
