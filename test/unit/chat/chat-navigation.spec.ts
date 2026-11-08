import {
  buildNavigationAction,
  isSafeChatRoute,
  resolveHelpSection,
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

  describe('section of the editor', () => {
    const editor = '/projects/one/editor';

    it.each([
      [
        'Editor',
        'PlumIA › Editor › Pantalla › Mostrar u ocultar la barra de herramientas de formato',
        'editor-toolbar',
      ],
      [
        'Ayuda',
        'PlumIA › Ayuda › Solución › No veo la barra de formato (negrita, tamaño de letra, listas)',
        'editor-toolbar',
      ],
      [
        'Chat IA',
        'PlumIA › Chat IA › Chat IA › Pantalla completa del chat',
        'editor-right-chat',
      ],
      [
        'Estadísticas',
        'PlumIA › Estadísticas › Metas › El panel Stats del Editor',
        'editor-right-stats',
      ],
      [
        'IA',
        'PlumIA › IA › Análisis › Propuestas de entidades: aceptar, editar o rechazar',
        'editor-right-review',
      ],
      [
        'IA',
        'PlumIA › IA › Análisis › Qué son las inconsistencias detectadas',
        'editor-right-review',
      ],
      [
        'Worldbuilding',
        'PlumIA › Worldbuilding › Wiki › El panel Wiki del Editor (consulta rápida)',
        'editor-right-wiki',
      ],
    ])('maps %s / %s to %s', (area, breadcrumb, expected) => {
      expect(resolveHelpSection({ route: editor, area, breadcrumb })).toBe(
        expected,
      );
    });

    it.each([
      ['historial.versiones.crear', 'editor-history'],
      ['problemas.perdi-texto', 'editor-history'],
      ['ia.propuestas.cambios-de-estado', 'editor-right-review'],
      ['problemas.no-aparecen-propuestas', 'editor-right-review'],
      ['editor.texto.color', 'editor-toolbar'],
      ['editor.parrafo.alinear', 'editor-toolbar'],
      ['editor.listas.numeradas', 'editor-toolbar'],
      ['editor.estilos.aplicar', 'editor-toolbar'],
      ['wiki.estado-temporal-agregar', 'editor-right-wiki'],
    ])(
      'resolves stable help ID %s independently of its displayed title',
      (id, expected) => {
        expect(
          resolveHelpSection({
            id,
            route: editor,
            area: 'Editor',
            breadcrumb: 'Título actualizado',
          }),
        ).toBe(expected);
      },
    );

    it('has no section for other editor topics or other screens', () => {
      expect(
        resolveHelpSection({
          route: editor,
          area: 'Editor',
          breadcrumb: 'PlumIA › Editor › Zoom del editor',
        }),
      ).toBeUndefined();
      expect(
        resolveHelpSection({
          route: '/projects/one/worldbuilding?tab=wiki',
          area: 'Chat IA',
          breadcrumb: 'PlumIA › Chat IA › Algo',
        }),
      ).toBeUndefined();
    });

    it('carries the section of the cited help source into the action', () => {
      const action = buildNavigationAction([
        {
          id: 'application_help:toolbar',
          kind: 'application_help',
          label:
            'PlumIA › Editor › Mostrar u ocultar la barra de herramientas de formato',
          excerpt: 'Barra',
          route: editor,
          section: 'editor-toolbar',
        },
      ]);
      expect(action).toMatchObject({
        route: editor,
        section: 'editor-toolbar',
      });
    });

    it('omits the section when the source has none', () => {
      const action = buildNavigationAction([
        {
          id: 'application_help:zoom',
          kind: 'application_help',
          label: 'PlumIA › Zoom',
          excerpt: 'Z',
          route: editor,
        },
      ]);
      expect(action).not.toHaveProperty('section');
    });
  });
});
