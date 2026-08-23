import type { ChatAction } from './chat.types';

interface ApplicationGuide {
  patterns: readonly GuidePattern[];
  label: string;
  answer: string;
  path: (projectId: string) => string;
}

interface GuidePattern {
  pattern: RegExp;
  weight: number;
}

export interface ApplicationHistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const NAVIGATION_INTENT =
  /\b(?:donde|como\s+(?:puedo\s+)?(?:ver|abr(?:ir|o)|acceder|ir|usar|revis(?:ar|o)|consult(?:ar|o)|encontrar)|quiero\s+(?:ir|ver|abrir|consultar)|en que (?:lugar|seccion|pantalla)|llev(?:ame|ar(?:me)?)|mostrame|mandame|abrime)\b/i;
const APPLICATION_HELP_INTENT =
  /\b(?:ayuda|manual|documentacion|guia|funcionalidades?|como\s+(?:se\s+)?(?:usa|uso|usar|funciona)|para\s+que\s+sirve|que\s+(?:puedo|se\s+puede)\s+hacer)\b/i;
const FOLLOW_UP_INTENT = /^(?:[¿?¡!.,\s]*(?:y|tambien|ademas)\b)/i;

const GUIDES: ApplicationGuide[] = [
  {
    patterns: [
      {
        pattern:
          /\b(linea (?:de tiempo|temporal)|cronologia|eventos temporales)\b/i,
        weight: 10,
      },
      {
        pattern: /\b(?:hechos(?: que pasaron| narrativos)?|acontecimientos)\b/i,
        weight: 8,
      },
    ],
    label: 'PlumIA · Línea temporal',
    answer:
      'La Línea Temporal está dentro de Worldbuilding. Abrí Worldbuilding desde la barra inferior izquierda y elegí la pestaña “Línea Temporal”. Te dejo un acceso directo debajo de la respuesta.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=timeline`,
  },
  {
    patterns: [
      { pattern: /\b(?:storyboard|tablero)\b/i, weight: 10 },
      { pattern: /\b(?:notas?|ideas?|tarjetas?)\b/i, weight: 8 },
    ],
    label: 'PlumIA · Storyboard y notas',
    answer:
      'Tus notas e ideas están en el Tablero (Storyboard). Podés abrirlo desde la barra inferior izquierda; allí están las tarjetas Kanban y la vista matricial por arco y capítulo.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/storyboard`,
  },
  {
    patterns: [
      {
        pattern:
          /\b(?:wiki|fichas?|entidades?|personajes?|lugares?|objetos?)\b/i,
        weight: 10,
      },
    ],
    label: 'PlumIA · Wiki del universo',
    answer:
      'La Wiki se puede consultar rápidamente en el panel derecho del editor. Para editar fichas, imágenes y detalles, abrí Worldbuilding y entrá en “Wiki del Universo”.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=wiki`,
  },
  {
    patterns: [
      {
        pattern: /\b(?:editor|manuscrito|chat|asistente)\b/i,
        weight: 10,
      },
      { pattern: /\bescenas?\b/i, weight: 5 },
      { pattern: /\bcapitulos?\b/i, weight: 2 },
    ],
    label: 'PlumIA · Editor y manuscrito',
    answer:
      'El manuscrito se trabaja en el Editor. Desde la barra lateral podés elegir libros, capítulos y escenas; en el panel derecho tenés la Wiki, el chat y las estadísticas. También podés abrir el historial de versiones de la escena desde “Hist.”.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    patterns: [{ pattern: /\b(?:relaciones?|vinculos?|grafo)\b/i, weight: 10 }],
    label: 'PlumIA · Relaciones',
    answer:
      'Las relaciones entre entidades están en Worldbuilding, pestaña “Relaciones”. Desde allí podés ver y mantener los vínculos registrados.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=relationships`,
  },
  {
    patterns: [{ pattern: /\b(?:resumenes?|sinopsis)\b/i, weight: 10 }],
    label: 'PlumIA · Resúmenes',
    answer:
      'Los resúmenes están en Worldbuilding, pestaña “Resúmenes”. Allí podés consultar o generar resúmenes por escena, capítulo, libro o proyecto.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=summaries`,
  },
  {
    patterns: [
      {
        pattern: /\b(?:historial|versiones?|borradores? anteriores)\b/i,
        weight: 10,
      },
    ],
    label: 'PlumIA · Historial de versiones',
    answer:
      'El historial está dentro del editor. Elegí una escena y abrí “Hist.” en la barra inferior izquierda para ver, nombrar, restaurar o eliminar versiones.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    patterns: [
      {
        pattern:
          /\b(?:auditoria|alertas?|inconsistencias?|continuidad|plot police)\b/i,
        weight: 10,
      },
    ],
    label: 'PlumIA · Auditoría de continuidad',
    answer:
      'Las alertas de continuidad aparecen en el panel Wiki del Editor, donde podés revisar la evidencia y resolver o descartar cada inconsistencia detectada.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    patterns: [
      {
        pattern: /\b(?:estadisticas?|stats|metricas?)\b/i,
        weight: 10,
      },
    ],
    label: 'PlumIA · Estadísticas del editor',
    answer:
      'Las estadísticas están en el panel derecho del Editor, en la pestaña “Stats”, junto a la Wiki y el chat.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
];

const GENERAL_APPLICATION_GUIDE: ApplicationGuide = {
  patterns: [],
  label: 'PlumIA · Guía de uso',
  answer:
    'Soy el asistente de consulta de PlumIA. Puedo buscar información respaldada por tu manuscrito, entidades y relaciones de la Wiki y hechos de la Línea Temporal.\n\nTambién puedo indicarte dónde está cada función y llevarte a cualquier sección de la aplicación: el manuscrito y el chat están en el Editor; la Wiki, las Relaciones, la Línea Temporal y los Resúmenes están en Worldbuilding; y las notas e ideas están en el Storyboard. Te voy a mostrar un acceso directo separado de las fuentes de la obra.',
  path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
};

export function getApplicationGuidance(
  question: string,
  projectId: string,
  context: { history?: readonly ApplicationHistoryEntry[] } = {},
): { answer: string; action: ChatAction } | null {
  const normalizedQuestion = normalizeQuestion(question);
  const isNavigationQuestion = NAVIGATION_INTENT.test(normalizedQuestion);
  const isApplicationHelpQuestion =
    APPLICATION_HELP_INTENT.test(normalizedQuestion);
  const guide = findBestGuide(normalizedQuestion);
  const isFollowUpNavigation =
    FOLLOW_UP_INTENT.test(normalizedQuestion) &&
    Boolean(guide) &&
    context.history?.some(
      (entry) => entry.role === 'user' && isApplicationQuestion(entry.content),
    );
  if (
    !isNavigationQuestion &&
    !isApplicationHelpQuestion &&
    !isFollowUpNavigation
  ) {
    return null;
  }
  const selectedGuide =
    guide ?? (isApplicationHelpQuestion ? GENERAL_APPLICATION_GUIDE : null);
  if (!selectedGuide) {
    return null;
  }
  const route = selectedGuide.path(projectId);
  const action: ChatAction = {
    id: `navigation:${route}`,
    kind: 'navigation',
    label: selectedGuide.label,
    description: 'Abrir esta sección de PlumIA',
    route,
  };
  return {
    answer: selectedGuide.answer,
    action,
  };
}

function findBestGuide(question: string): ApplicationGuide | null {
  let bestGuide: ApplicationGuide | null = null;
  let bestScore = 0;

  for (const guide of GUIDES) {
    const score = guide.patterns.reduce(
      (total, entry) =>
        total + (entry.pattern.test(question) ? entry.weight : 0),
      0,
    );
    if (score > bestScore) {
      bestGuide = guide;
      bestScore = score;
    }
  }

  return bestGuide;
}

function isApplicationQuestion(question: string): boolean {
  const normalizedQuestion = normalizeQuestion(question);
  return (
    NAVIGATION_INTENT.test(normalizedQuestion) ||
    APPLICATION_HELP_INTENT.test(normalizedQuestion)
  );
}

function normalizeQuestion(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
