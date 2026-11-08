import type { ChatAction, ChatSection, ChatSource } from './chat.types';

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

export function buildNavigationAction(
  citedSources: readonly ChatSource[],
): ChatAction | null {
  const source = citedSources
    .filter(
      (item) =>
        item.kind === 'application_help' &&
        item.route &&
        isSafeChatRoute(item.route),
    )
    .sort(
      (left, right) =>
        routeSpecificity(right.route ?? '') +
        (right.section ? 1 : 0) -
        (routeSpecificity(left.route ?? '') + (left.section ? 1 : 0)),
    )[0];
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

function routeSpecificity(route: string): number {
  const url = new URL(route, 'https://plumia.invalid');
  return (
    url.pathname.split('/').filter(Boolean).length + url.searchParams.size * 2
  );
}
