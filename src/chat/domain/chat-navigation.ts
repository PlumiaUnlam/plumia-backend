import type { ChatAction, ChatSection, ChatSource } from './chat.types';

/** Accepts only same-origin relative routes, so a shortcut can never leave the app. */
export function isSafeChatRoute(route: string): boolean {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\') ||
    route.includes('{') ||
    [...route].some((character) => (character.codePointAt(0) ?? 0) < 32) ||
    route.length > 2_048
  ) {
    return false;
  }
  try {
    return (
      new URL(route, 'https://plumia.invalid').origin ===
      'https://plumia.invalid'
    );
  } catch {
    return false;
  }
}

const EDITOR_ROUTE = /^\/projects\/[^/]+\/editor$/;

const HELP_SECTION_PREFIXES: readonly (readonly [string, ChatSection])[] = [
  ['historial.versiones.', 'editor-history'],
  ['ia.revision.', 'editor-right-review'],
  ['ia.propuestas.', 'editor-right-review'],
  ['ia.inconsistencias.', 'editor-right-review'],
  ['editor.texto.', 'editor-toolbar'],
  ['editor.parrafo.', 'editor-toolbar'],
  ['editor.listas.', 'editor-toolbar'],
  ['editor.estilos.', 'editor-toolbar'],
  ['wiki.estado-temporal', 'editor-right-wiki'],
];

const HELP_SECTION_IDS: ReadonlyMap<string, ChatSection> = new Map([
  ['problemas.perdi-texto', 'editor-history'],
  ['problemas.no-aparecen-propuestas', 'editor-right-review'],
  ['problemas.estado-superpuesto', 'editor-right-wiki'],
]);

/** Uses stable documentation IDs before falling back to displayed titles. */
function helpSectionFromId(id: string | undefined): ChatSection | undefined {
  if (!id) {
    return undefined;
  }
  return (
    HELP_SECTION_IDS.get(id) ??
    HELP_SECTION_PREFIXES.find(([prefix]) => id.startsWith(prefix))?.[1]
  );
}

/**
 * Parte del editor a la que apunta una entrada de la ayuda. Se deduce del área y del
 * último tramo del breadcrumb, porque todas comparten la ruta del editor.
 */
export function resolveHelpSection(chunk: {
  id?: string;
  route: string;
  area: string;
  breadcrumb: string;
}): ChatSection | undefined {
  const path = chunk.route.split('?')[0] ?? '';
  if (!EDITOR_ROUTE.test(path)) {
    return undefined;
  }
  const section = helpSectionFromId(chunk.id);
  if (section) {
    return section;
  }
  const leaf = chunk.breadcrumb.split(' › ').at(-1) ?? '';
  if (/barra de (?:herramientas|formato)/i.test(leaf)) {
    return 'editor-toolbar';
  }
  if (chunk.area === 'Chat IA') {
    return 'editor-right-chat';
  }
  if (chunk.area === 'Estadísticas' || /panel Stats/i.test(leaf)) {
    return 'editor-right-stats';
  }
  if (/Modo Revisión|propuestas?|inconsistencias?/i.test(leaf)) {
    return 'editor-right-review';
  }
  if (/panel Wiki del Editor/i.test(leaf)) {
    return 'editor-right-wiki';
  }
  return undefined;
}

/**
 * Selects the destination the answer leans on most: the route cited by more sources wins,
 * then the more specific route, then the one cited first. Having a `section` is not a
 * reason to prefer a destination, so an answer about Worldbuilding leads to Worldbuilding
 * even if it also cites an editor proposal.
 */
export function buildNavigationAction(
  citedSources: readonly ChatSource[],
): ChatAction | null {
  const candidates = citedSources.filter(
    (item) =>
      item.kind === 'application_help' &&
      item.route &&
      isSafeChatRoute(item.route),
  );
  const citations = new Map<string, number>();
  for (const item of candidates) {
    const route = item.route ?? '';
    citations.set(route, (citations.get(route) ?? 0) + 1);
  }
  const source = candidates
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        (citations.get(right.item.route ?? '') ?? 0) -
          (citations.get(left.item.route ?? '') ?? 0) ||
        routeSpecificity(right.item.route ?? '') -
          routeSpecificity(left.item.route ?? '') ||
        left.index - right.index,
    )[0]?.item;
  if (!source?.route) {
    return null;
  }
  return {
    id: `navigation:${source.route}`,
    kind: 'navigation',
    label: source.label.split(' › ').at(-1) ?? source.label,
    description: 'Abrir esta sección de PlumIA',
    route: source.route,
    ...(source.section ? { section: source.section } : {}),
  };
}

/** Scores a route by its path depth and query parameters; deeper routes are more specific. */
function routeSpecificity(route: string): number {
  const url = new URL(route, 'https://plumia.invalid');
  return (
    url.pathname.split('/').filter(Boolean).length + url.searchParams.size * 2
  );
}
