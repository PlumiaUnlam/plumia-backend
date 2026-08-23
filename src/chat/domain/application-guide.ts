import type { ChatSource } from './chat.types';

interface ApplicationGuide {
  matches: RegExp;
  label: string;
  answer: string;
  path: (projectId: string) => string;
}

const NAVIGATION_INTENT =
  /\b(?:donde|como\s+(?:puedo\s+)?(?:ver|abr(?:ir|o)|acceder|ir|usar|revis(?:ar|o)|consult(?:ar|o)|encontrar)|quiero\s+(?:ir|ver|abrir|consultar)|en que (?:lugar|seccion|pantalla)|llev(?:ame|ar(?:me)?)|mostrame|mandame|abrime)\b/i;
const APPLICATION_HELP_INTENT =
  /\b(?:ayuda|manual|documentacion|guia|funcionalidades?|como\s+(?:se\s+)?(?:usa|uso|usar|funciona)|para\s+que\s+sirve|que\s+(?:puedo|se\s+puede)\s+hacer)\b/i;

const GUIDES: ApplicationGuide[] = [
  {
    matches:
      /\b(linea (?:de tiempo|temporal)|cronologia|eventos temporales)\b/i,
    label: 'PlumIA · Línea temporal',
    answer:
      'La Línea Temporal está dentro de Worldbuilding. Abrí Worldbuilding desde la barra inferior izquierda y elegí la pestaña “Línea Temporal”. También podés abrirla desde la referencia de abajo.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=timeline`,
  },
  {
    matches: /\b(notas?|ideas?|tarjetas?|storyboard|tablero)\b/i,
    label: 'PlumIA · Storyboard y notas',
    answer:
      'Tus notas e ideas están en el Tablero (Storyboard). Podés abrirlo desde la barra inferior izquierda; allí están las tarjetas Kanban y la vista matricial por arco y capítulo.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/storyboard`,
  },
  {
    matches: /\b(wiki|fichas?|entidades?|personajes?|lugares?|objetos?)\b/i,
    label: 'PlumIA · Wiki del universo',
    answer:
      'La Wiki se puede consultar rápidamente en el panel derecho del editor. Para editar fichas, imágenes y detalles, abrí Worldbuilding y entrá en “Wiki del Universo”.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=wiki`,
  },
  {
    matches:
      /\b(editor|manuscrito|escenas?|capitulos?|capítulos?|chat|asistente)\b/i,
    label: 'PlumIA · Editor y manuscrito',
    answer:
      'El manuscrito se trabaja en el Editor. Desde la barra lateral podés elegir libros, capítulos y escenas; en el panel derecho tenés la Wiki, el chat y las estadísticas. También podés abrir el historial de versiones de la escena desde “Hist.”.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    matches: /\b(relaciones?|vinculos?|grafo)\b/i,
    label: 'PlumIA · Relaciones',
    answer:
      'Las relaciones entre entidades están en Worldbuilding, pestaña “Relaciones”. Desde allí podés ver y mantener los vínculos registrados.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=relationships`,
  },
  {
    matches: /\b(resumenes?|sinopsis)\b/i,
    label: 'PlumIA · Resúmenes',
    answer:
      'Los resúmenes están en Worldbuilding, pestaña “Resúmenes”. Allí podés consultar o generar resúmenes por escena, capítulo, libro o proyecto.',
    path: (projectId) =>
      `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=summaries`,
  },
  {
    matches: /\b(historial|versiones?|borradores? anteriores)\b/i,
    label: 'PlumIA · Historial de versiones',
    answer:
      'El historial está dentro del editor. Elegí una escena y abrí “Hist.” en la barra inferior izquierda para ver, nombrar, restaurar o eliminar versiones.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    matches:
      /\b(auditoria|auditoría|alertas?|inconsistencias?|continuidad|plot police)\b/i,
    label: 'PlumIA · Auditoría de continuidad',
    answer:
      'Las alertas de continuidad aparecen en el panel Wiki del Editor, donde podés revisar la evidencia y resolver o descartar cada inconsistencia detectada.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
  {
    matches: /\b(estadisticas?|estadísticas?|stats|metricas?|métricas?)\b/i,
    label: 'PlumIA · Estadísticas del editor',
    answer:
      'Las estadísticas están en el panel derecho del Editor, en la pestaña “Stats”, junto a la Wiki y el chat.',
    path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
  },
];

const GENERAL_APPLICATION_GUIDE: ApplicationGuide = {
  matches: /$^/,
  label: 'PlumIA · Guía de uso',
  answer:
    'Soy el asistente de consulta de PlumIA. Puedo buscar información respaldada por tu manuscrito, entidades y relaciones de la Wiki y hechos de la Línea Temporal.\n\nTambién puedo indicarte dónde está cada función y llevarte a cualquier sección de la aplicación: el manuscrito y el chat están en el Editor; la Wiki, las Relaciones, la Línea Temporal y los Resúmenes están en Worldbuilding; y las notas e ideas están en el Storyboard. Las referencias de mis respuestas se pueden abrir desde el ícono de enlace.',
  path: (projectId) => `/projects/${encodeURIComponent(projectId)}/editor`,
};

export function getApplicationGuidance(
  question: string,
  projectId: string,
): { answer: string; source: ChatSource } | null {
  const normalizedQuestion = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const isNavigationQuestion = NAVIGATION_INTENT.test(normalizedQuestion);
  const isApplicationHelpQuestion =
    APPLICATION_HELP_INTENT.test(normalizedQuestion);
  if (!isNavigationQuestion && !isApplicationHelpQuestion) {
    return null;
  }
  const guide =
    GUIDES.find((entry) => entry.matches.test(normalizedQuestion)) ??
    (isApplicationHelpQuestion ? GENERAL_APPLICATION_GUIDE : null);
  if (!guide) {
    return null;
  }
  const route = guide.path(projectId);
  return {
    answer: guide.answer,
    source: {
      id: `application:${guide.label}`,
      kind: 'application',
      label: guide.label,
      excerpt: guide.answer,
      route,
    },
  };
}
