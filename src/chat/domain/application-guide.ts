import type { ChatSource } from './chat.types';

interface ApplicationGuide {
  matches: RegExp;
  label: string;
  answer: string;
  path: (projectId: string) => string;
}

const NAVIGATION_INTENT =
  /\b(donde|como\s+(?:puedo\s+)?(?:ver|abrir|acceder|ir)|en que (?:lugar|seccion|pantalla)|llevame|mostrame donde)\b/i;

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
];

export function getApplicationGuidance(
  question: string,
  projectId: string,
): { answer: string; source: ChatSource } | null {
  const normalizedQuestion = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (!NAVIGATION_INTENT.test(normalizedQuestion)) {
    return null;
  }
  const guide = GUIDES.find((entry) => entry.matches.test(normalizedQuestion));
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
