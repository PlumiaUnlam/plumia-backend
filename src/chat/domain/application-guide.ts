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

const NAVIGATION_PHRASES = [
  'donde puedo',
  'donde puede',
  'donde se',
  'donde esta',
  'donde estan',
  'donde veo',
  'donde ver',
  'donde consulto',
  'donde consultar',
  'donde encuentro',
  'donde encontrar',
  'donde queda',
  'donde quedan',
  'donde miro',
  'donde mirar',
  'en que lugar',
  'en que seccion',
  'en que pantalla',
  'como ver',
  'como puedo ver',
  'como abrir',
  'como puedo abrir',
  'como abro',
  'como acceder',
  'como puedo acceder',
  'como ir',
  'como puedo ir',
  'como usar',
  'como puedo usar',
  'como revisar',
  'como puedo revisar',
  'como reviso',
  'como consultar',
  'como puedo consultar',
  'como consulto',
  'como encontrar',
  'como puedo encontrar',
  'quiero ir',
  'quiero ver',
  'quiero abrir',
  'quiero consultar',
  'llevame',
  'llevar',
  'llevarme',
  'mostrame',
  'mandame',
  'abrime',
] as const;
const APPLICATION_HELP_TERMS = [
  'ayuda',
  'manual',
  'documentacion',
  'guia',
  'funcionalidad',
  'funcionalidades',
  'modo de escritura',
  'modos de escritura',
  'para que sirve',
  'que puedo hacer',
  'que se puede hacer',
] as const;
const APPLICATION_HOW_TO_TERMS = [
  'como usa',
  'como uso',
  'como usar',
  'como funciona',
  'como funcionan',
  'como se usa',
  'como se usar',
] as const;
const APPLICATION_UI_TERMS = [
  'aplicacion',
  'plumia',
  'editor',
  'wiki',
  'storyboard',
  'tablero',
  'linea de tiempo',
  'linea temporal',
  'resumen',
  'resumenes',
  'historial',
  'estadistica',
  'estadisticas',
  'chat',
  'asistente',
  'pestana',
  'pestanas',
  'panel',
  'seccion',
  'pantalla',
  'boton',
  'menu',
  'barra',
  'interfaz',
  'modo de escritura',
  'modos de escritura',
] as const;
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
        pattern: /\b(?:wiki|fichas?|entidades?|lugares?|objetos?)\b/i,
        weight: 10,
      },
      { pattern: /\bpersonajes?\b/i, weight: 7 },
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
    patterns: [
      {
        pattern: /\b(?:relaciones?|vinculos?)\s+(?:entre|de|con)\b/i,
        weight: 16,
      },
      { pattern: /\b(?:relaciones?|vinculos?|grafo)\b/i, weight: 10 },
    ],
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
      { pattern: /\bmodos?\s+de\s+escritura\b/i, weight: 16 },
      {
        pattern: /\bmodo(?:s)?\s+(?:de\s+)?(?:creacion|revision|zen)\b/i,
        weight: 14,
      },
    ],
    label: 'PlumIA · Modos de escritura',
    answer:
      'Los modos de escritura se seleccionan arriba del Editor. “Creación” mantiene el editor y sus paneles de consulta, pero oculta las secciones de revisión. “Revisión” muestra las inconsistencias, relaciones y propuestas detectadas dentro de la Wiki para que puedas revisarlas. “Zen” oculta las barras laterales y el panel derecho para concentrarte en el manuscrito; la barra de formato aparece al pasar el cursor por la parte superior. Cambiar de modo solo modifica la vista actual y no cambia el contenido de tu obra.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
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
  const isNavigationQuestion = isNavigationIntent(normalizedQuestion);
  const isApplicationHelpQuestion = isApplicationHelp(normalizedQuestion);
  const guide = findBestGuide(normalizedQuestion);
  const lastUserQuestion = [...(context.history ?? [])]
    .reverse()
    .find((entry) => entry.role === 'user');
  const isFollowUpNavigation =
    FOLLOW_UP_INTENT.test(normalizedQuestion) &&
    Boolean(guide) &&
    Boolean(
      lastUserQuestion && isApplicationQuestion(lastUserQuestion.content),
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
    isNavigationIntent(normalizedQuestion) ||
    isApplicationHelp(normalizedQuestion)
  );
}

function isApplicationHelp(question: string): boolean {
  return (
    hasAnyTerm(question, APPLICATION_UI_TERMS) &&
    (hasAnyTerm(question, APPLICATION_HELP_TERMS) ||
      hasAnyTerm(question, APPLICATION_HOW_TO_TERMS))
  );
}

function isNavigationIntent(question: string): boolean {
  return hasAnyTerm(question, NAVIGATION_PHRASES);
}

function hasAnyTerm(value: string, terms: readonly string[]): boolean {
  return terms.some((term) => hasWholePhrase(value, term));
}

function hasWholePhrase(value: string, phrase: string): boolean {
  let start = value.indexOf(phrase);
  while (start >= 0) {
    const before = value[start - 1];
    const after = value[start + phrase.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) {
      return true;
    }
    start = value.indexOf(phrase, start + phrase.length);
  }
  return false;
}

function isWordCharacter(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const code = value.codePointAt(0);
  if (code === undefined) {
    return false;
  }
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 122);
}

function normalizeQuestion(question: string): string {
  return question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
