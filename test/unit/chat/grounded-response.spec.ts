import { buildGroundedResponse } from '../../../src/chat/domain/grounded-response';
import type { ChatSource } from '../../../src/chat/domain/chat.types';

describe('buildGroundedResponse', () => {
  const sources: ChatSource[] = [
    {
      id: 'manuscript:1',
      kind: 'manuscript',
      label: 'Capítulo 1',
      excerpt: 'Maren entró al archivo bajo una lluvia intensa.',
    },
    {
      id: 'wiki:1',
      kind: 'wiki',
      label: 'Maren',
      excerpt: 'Maren es la archivista de la ciudad.',
    },
  ];

  it('renders per-claim citation numbers in first-use order', () => {
    const result = buildGroundedResponse(
      {
        answer: 'ignored adapter rendering',
        sourceIds: ['wiki:1', 'manuscript:1'],
        claims: [
          {
            text: 'Maren es archivista.',
            evidence: [{ sourceId: 'wiki:1', quote: 'Maren es la archivista' }],
          },
          {
            text: 'Entró al archivo bajo la lluvia.',
            evidence: [
              {
                sourceId: 'manuscript:1',
                quote: 'entró al archivo bajo una lluvia intensa',
              },
            ],
          },
        ],
        inputTokens: 20,
        outputTokens: 8,
      },
      sources,
    );

    expect(result.answer).toBe(
      'Maren es archivista. [1]\n\nEntró al archivo bajo la lluvia. [2]',
    );
    expect(result.sources.map((source) => source.id)).toEqual([
      'wiki:1',
      'manuscript:1',
    ]);
  });

  it.each([
    {
      text: 'unknown source id',
      evidence: [{ sourceId: 'wiki:missing', quote: 'Maren es la archivista' }],
    },
    {
      text: 'fabricated quote',
      evidence: [{ sourceId: 'wiki:1', quote: 'Maren nació en el bosque' }],
    },
    { text: 'missing evidence', evidence: [] },
    {
      text: 'meaningless short quote',
      evidence: [{ sourceId: 'wiki:1', quote: 'Maren' }],
    },
  ])('rejects the entire result for $text', (claim) => {
    const result = buildGroundedResponse(
      {
        answer: 'Afirmación no respaldada',
        sourceIds: claim.evidence.map((item) => item.sourceId),
        claims: [
          { text: 'Afirmación no respaldada', evidence: claim.evidence },
        ],
        inputTokens: 10,
        outputTokens: 5,
      },
      sources,
    );

    expect(result.answer).toContain('no demuestra');
    expect(result.sources).toEqual([]);
  });
});
