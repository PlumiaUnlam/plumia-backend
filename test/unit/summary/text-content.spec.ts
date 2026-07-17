import {
  estimateTokens,
  extractNarrativeText,
  splitTextByTokenBudget,
} from '../../../src/summary/domain/text-content';

describe('summary text content', () => {
  it('extracts readable text from a Tiptap document', () => {
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Llegada' }] },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'El tren llegó de noche.' }],
        },
      ],
    };

    expect(extractNarrativeText(content)).toContain('Llegada');
    expect(extractNarrativeText(content)).toContain('El tren llegó de noche.');
  });

  it('keeps paragraphs whole while splitting large scenes', () => {
    const text = [
      'uno '.repeat(200),
      'dos '.repeat(200),
      'tres '.repeat(200),
    ].join('\n\n');
    const chunks = splitTextByTokenBudget(text, 250);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => estimateTokens(chunk) <= 250)).toBe(true);
  });

  it('splits an oversized paragraph at sentence boundaries', () => {
    const text = Array.from(
      { length: 20 },
      (_, index) => `Sentence ${index + 1} contains enough words to be useful.`,
    ).join(' ');

    const chunks = splitTextByTokenBudget(text, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => estimateTokens(chunk) <= 80)).toBe(true);
    expect(chunks.every((chunk) => /[.!?]$/.test(chunk))).toBe(true);
  });

  it('splits a single oversized sentence without exceeding its budget', () => {
    const text = 'word '.repeat(500).trim();

    const chunks = splitTextByTokenBudget(text, 80);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => estimateTokens(chunk) <= 80)).toBe(true);
  });
});
