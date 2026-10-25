import type { ChatAction, ChatSource } from './chat.types';

export function isSafeChatRoute(route: string): boolean {
  if (
    !route.startsWith('/') ||
    route.startsWith('//') ||
    route.includes('\\') ||
    route.includes('{') ||
    [...route].some((character) => character.charCodeAt(0) < 32) ||
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
        routeSpecificity(right.route ?? '') -
        routeSpecificity(left.route ?? ''),
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
  };
}

function routeSpecificity(route: string): number {
  const url = new URL(route, 'https://plumia.invalid');
  return (
    url.pathname.split('/').filter(Boolean).length + url.searchParams.size * 2
  );
}
