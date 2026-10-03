import { validate, type ValidationError } from 'class-validator';
import { UpdateSceneContentDto } from '../../../../src/manuscript/dto/scenes/update-scene-content.dto';

function docWithFootnote(overrides: {
  id?: unknown;
  noteType?: unknown;
  body?: unknown[];
  nestedFootnote?: boolean;
}): Record<string, unknown> {
  const {
    id = 'note-1',
    noteType = 'FOOTNOTE',
    nestedFootnote = false,
  } = overrides;

  const body = overrides.body ?? [
    { type: 'paragraph', content: [{ type: 'text', text: 'Aclaración.' }] },
    ...(nestedFootnote
      ? [
          {
            type: 'footnoteReference',
            attrs: { id: 'note-nested', noteType: 'FOOTNOTE' },
            content: [{ type: 'paragraph' }],
          },
        ]
      : []),
  ];

  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Texto principal.' },
          {
            type: 'footnoteReference',
            attrs: { id, noteType },
            content: body,
          },
        ],
      },
    ],
  };
}

async function validateContent(
  content: Record<string, unknown>,
): Promise<ValidationError[]> {
  const dto = new UpdateSceneContentDto();
  dto.content = content;
  return validate(dto);
}

describe('IsTipTapDocument footnote/endnote validation', () => {
  it('accepts a valid FOOTNOTE node', async () => {
    const errors = await validateContent(docWithFootnote({}));
    expect(errors).toHaveLength(0);
  });

  it('accepts a valid ENDNOTE node', async () => {
    const errors = await validateContent(
      docWithFootnote({ noteType: 'ENDNOTE' }),
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an invalid noteType', async () => {
    const errors = await validateContent(
      docWithFootnote({ noteType: 'FOOTNOTEx' }),
    );
    expect(errors).toHaveLength(1);
  });

  it('rejects a duplicate note id within the same document', async () => {
    const doc = docWithFootnote({});
    const paragraph = (doc['content'] as Record<string, unknown>[])[0]!;
    (paragraph['content'] as unknown[]).push({
      type: 'footnoteReference',
      attrs: { id: 'note-1', noteType: 'ENDNOTE' },
      content: [{ type: 'paragraph' }],
    });

    const errors = await validateContent(doc);
    expect(errors).toHaveLength(1);
  });

  it('rejects a footnote nested inside another footnote body', async () => {
    const errors = await validateContent(
      docWithFootnote({ nestedFootnote: true }),
    );
    expect(errors).toHaveLength(1);
  });

  it('rejects an empty or missing note id', async () => {
    const errors = await validateContent(docWithFootnote({ id: '' }));
    expect(errors).toHaveLength(1);
  });
});
