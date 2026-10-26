import {
  buildNavigationAction,
  isSafeChatRoute,
} from '../../../src/chat/domain/chat-navigation';
import type { ChatSource } from '../../../src/chat/domain/chat.types';

describe('chat navigation', () => {
  it.each([
    'https://evil.example/path',
    '//evil.example/path',
    '/projects/{projectId}/editor',
    '/projects/one\\evil',
    '/projects/one\n/admin',
  ])('rejects an unsafe route: %s', (route) => {
    expect(isSafeChatRoute(route)).toBe(false);
  });

  it('selects the most specific cited help route', () => {
    const sources: ChatSource[] = [
      {
        id: 'application_help:general',
        kind: 'application_help',
        label: 'PlumIA › Worldbuilding',
        excerpt: 'General',
        route: '/projects/one/worldbuilding',
      },
      {
        id: 'application_help:timeline',
        kind: 'application_help',
        label: 'PlumIA › Línea Temporal',
        excerpt: 'Temporal',
        route: '/projects/one/worldbuilding?tab=timeline',
      },
    ];

    expect(buildNavigationAction(sources)).toMatchObject({
      kind: 'navigation',
      label: 'Línea Temporal',
      route: '/projects/one/worldbuilding?tab=timeline',
    });
  });

  it('never creates a navigation action from a work source or external route', () => {
    const sources: ChatSource[] = [
      {
        id: 'wiki:one',
        kind: 'wiki',
        label: 'Wiki',
        excerpt: 'Contenido',
        route: '/projects/one/wiki',
      },
      {
        id: 'application_help:malicious',
        kind: 'application_help',
        label: 'Fuera de PlumIA',
        excerpt: 'Contenido',
        route: '//evil.example',
      },
    ];

    expect(buildNavigationAction(sources)).toBeNull();
  });
});
