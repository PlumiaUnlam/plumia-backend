import {
  presentReviewedSources,
  withConflictNotice,
} from '../../../src/chat/domain/chat-source-presentation';
import type { ChatSource } from '../../../src/chat/domain/chat.types';

describe('chat source presentation', () => {
  const manuscript: ChatSource = {
    id: 'manuscript:1',
    kind: 'manuscript',
    label: 'Capítulo 1',
    excerpt: 'Maren llegó.',
  };
  const wiki: ChatSource = {
    id: 'wiki:1',
    kind: 'wiki',
    label: 'Maren',
    excerpt: 'Maren vive en el puerto.',
  };

  it('puts cited sources first and retains the remaining reviewed sources', () => {
    expect(presentReviewedSources([wiki], [manuscript, wiki])).toEqual([
      { ...wiki, cited: true, primary: true },
      { ...manuscript, cited: false, primary: true },
    ]);
  });

  it('marks only the first three sources as principal', () => {
    const reviewed = Array.from(
      { length: 5 },
      (_, index): ChatSource => ({
        id: `manuscript:${index}`,
        kind: 'manuscript',
        label: `Escena ${index}`,
        excerpt: `Fragmento ${index}`,
      }),
    );

    const result = presentReviewedSources([reviewed[0]!], reviewed);

    expect(result.map((source) => source.primary)).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(result.map((source) => source.cited)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it('adds a review action for an unresolved alert', () => {
    const notice = withConflictNotice(
      'Respuesta respaldada. [1]',
      [
        {
          id: 'alert-1',
          title: 'Maren figura en dos lugares',
          description: null,
          explanation: null,
          sceneId: 'scene-1',
        },
      ],
      'project-1',
    );

    expect(notice.answer).toContain('inconsistencia abierta');
    expect(notice.actions).toEqual([
      expect.objectContaining({
        kind: 'navigation',
        route: '/projects/project-1/editor?alertId=alert-1',
      }),
    ]);
  });
});
