import { buildGroundedResponse } from '../../../src/chat/domain/grounded-response';
import type { ChatSource } from '../../../src/chat/domain/chat.types';
import type { ChatGenerationResult } from '../../../src/chat/ports/chat-generation-provider.port';

import {
  describeGroundingProblems,
  repairEvidenceSources,
} from '../../../src/chat/domain/grounded-response';

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

  it('describes why a generated answer would not be grounded', () => {
    const sources = [
      {
        id: 'manuscript:1',
        kind: 'manuscript' as const,
        label: 'Capítulo 1',
        excerpt: 'Maren llegó al archivo bajo la lluvia.',
      },
    ];
    const problems = describeGroundingProblems(
      {
        answer: '',
        sourceIds: [],
        inputTokens: 0,
        outputTokens: 0,
        claims: [
          { text: 'Sin cita.', evidence: [] },
          {
            text: 'Fuente inventada.',
            evidence: [{ sourceId: 'manuscript:x', quote: 'cualquier cosa' }],
          },
          {
            text: 'Quote inexistente.',
            evidence: [{ sourceId: 'manuscript:1', quote: 'Maren nació allí' }],
          },
          {
            text: 'Todo bien.',
            evidence: [
              { sourceId: 'manuscript:1', quote: 'llegó al archivo bajo' },
            ],
          },
        ],
      },
      sources,
    );

    expect(problems).toEqual([
      'Afirmacion 1: no tiene evidencia',
      'Afirmacion 2: el sourceId "manuscript:x" no existe entre las fuentes recuperadas',
      'Afirmacion 3: la quote no aparece literal en manuscript:1',
    ]);
  });

  describe('repairEvidenceSources', () => {
    const sources = [
      {
        id: 'manuscript:b4a0465d-9fe8-49f2-97db-fbb758c5e1e4',
        kind: 'manuscript' as const,
        label: 'Capítulo 2',
        excerpt: 'Gregson estaba convencido de que Arthur lo había matado.',
      },
      {
        id: 'manuscript:dae16dfc-6321-4957-b866-f1ed98e4d99d',
        kind: 'manuscript' as const,
        label: 'Capítulo 3',
        excerpt: 'Drebber murió en Lauriston Gardens aquella noche.',
      },
    ];
    const result = (sourceId: string, quote: string): ChatGenerationResult => ({
      answer: '',
      sourceIds: [],
      inputTokens: 0,
      outputTokens: 0,
      claims: [{ text: 'Afirmación.', evidence: [{ sourceId, quote }] }],
    });

    it('reattaches a literal quote whose source id was garbled', () => {
      const repaired = repairEvidenceSources(
        result(
          'manuscript:1a0465d-9fe8-49f2-97db-fbb758c5e1e4',
          'Gregson estaba convencido de que Arthur lo había matado.',
        ),
        sources,
      );

      expect(repaired.claims[0]?.evidence[0]?.sourceId).toBe(
        'manuscript:b4a0465d-9fe8-49f2-97db-fbb758c5e1e4',
      );
      expect(describeGroundingProblems(repaired, sources)).toEqual([]);
    });

    it('moves a quote to the source that really contains it', () => {
      const repaired = repairEvidenceSources(
        result(sources[0]!.id, 'Drebber murió en Lauriston Gardens'),
        sources,
      );

      expect(repaired.claims[0]?.evidence[0]?.sourceId).toBe(sources[1]?.id);
    });

    it('never repairs a quote that is not in any retrieved source', () => {
      const invented = result(
        'manuscript:x',
        'Holmes tocaba el violín en el sótano',
      );

      expect(repairEvidenceSources(invented, sources)).toBe(invented);
      expect(describeGroundingProblems(invented, sources)).toHaveLength(1);
    });

    it('keeps correct citations and rejects empty quotes', () => {
      const valid = result(sources[0]!.id, 'Gregson estaba convencido');
      const placeholder = result('manuscript:placeholder', '');

      expect(repairEvidenceSources(valid, sources)).toBe(valid);
      expect(repairEvidenceSources(placeholder, sources)).toBe(placeholder);
    });
  });
});
