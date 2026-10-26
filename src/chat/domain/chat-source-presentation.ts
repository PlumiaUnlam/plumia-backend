import type { ChatAction, ChatOpenConflict, ChatSource } from './chat.types';

export const PRIMARY_CHAT_SOURCE_LIMIT = 3;

export function presentReviewedSources(
  citedSources: readonly ChatSource[],
  reviewedSources: readonly ChatSource[],
): ChatSource[] {
  const citedIds = new Set(citedSources.map((source) => source.id));
  const ordered = [
    ...citedSources.map((source) => ({ ...source, cited: true })),
    ...reviewedSources
      .filter((source) => !citedIds.has(source.id))
      .map((source) => ({ ...source, cited: false })),
  ];
  return ordered.map((source, index) => ({
    ...source,
    primary: index < PRIMARY_CHAT_SOURCE_LIMIT,
  }));
}

export function withConflictNotice(
  answer: string,
  conflicts: readonly ChatOpenConflict[],
  projectId: string,
): { answer: string; actions: ChatAction[] } {
  if (conflicts.length === 0) {
    return { answer, actions: [] };
  }
  const first = conflicts[0];
  if (!first) {
    return { answer, actions: [] };
  }
  const title = first.title.replace(/\s+/g, ' ').trim().slice(0, 140);
  const extraCount = conflicts.length - 1;
  const alertLabel =
    conflicts.length > 2 ? 'alertas relacionadas' : 'alerta relacionada';
  const extra =
    extraCount > 0 ? ` Hay al menos ${extraCount} ${alertLabel} más.` : '';
  return {
    answer: `${answer}\n\n⚠️ Hay una inconsistencia abierta relacionada: “${title}”.${extra} Revisala en Editor > Revisión > Wiki > Inconsistencias detectadas antes de tomar el dato disputado como definitivo.`,
    actions: [
      {
        id: `audit-alert:${first.id}`,
        kind: 'navigation',
        label: 'Revisar inconsistencia',
        description: 'Abrir Inconsistencias detectadas en modo Revisión',
        route: `/projects/${encodeURIComponent(projectId)}/editor?alertId=${encodeURIComponent(first.id)}`,
      },
    ],
  };
}
