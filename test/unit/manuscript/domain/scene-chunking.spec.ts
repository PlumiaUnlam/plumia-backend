import {
  countWords,
  createStringHash,
  planSceneChunks,
} from '../../../../src/manuscript/domain/scene-chunking';

describe('scene-chunking', () => {
  it('creates stable chunk plans from ProseMirror-like content', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph here.' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph here.' }],
        },
      ],
    };

    const result = planSceneChunks(content, { maxChars: 80, maxWords: 40 });

    expect(result).toEqual([
      {
        chunkIndex: 0,
        content: 'First paragraph here. Second paragraph here.',
        contentHash: createStringHash(
          'First paragraph here. Second paragraph here.',
        ),
        tokenCount: 6,
      },
    ]);
  });

  it('splits oversized blocks into multiple chunks respecting limits', () => {
    const text = Array.from(
      { length: 95 },
      (_, index) => `word${index + 1}`,
    ).join(' ');
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text }],
        },
      ],
    };

    const result = planSceneChunks(content, { maxChars: 600, maxWords: 90 });

    expect(result.length).toBeGreaterThan(1);
    expect(result.every((chunk) => chunk.tokenCount <= 90)).toBe(true);
    expect(result.map((chunk) => chunk.chunkIndex)).toEqual([0, 1]);
  });

  it('ignores unsupported or empty nodes safely', () => {
    const result = planSceneChunks(
      [
        null,
        'ignored',
        { type: 'paragraph', content: [{ type: 'text', text: '  kept  ' }] },
        { type: 'image', attrs: { src: 'x' } },
      ],
      { maxChars: 80, maxWords: 40 },
    );

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe('kept');
  });

  it('counts words and hashes strings deterministically', () => {
    expect(countWords('  hello   world  again ')).toBe(3);
    expect(createStringHash('same-value')).toBe(createStringHash('same-value'));
    expect(createStringHash('same-value')).not.toBe(createStringHash('other'));
  });
});
