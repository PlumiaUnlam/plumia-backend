import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

const TIPTAP_DOCUMENT = 'tiptapDocument';
const FOOTNOTE_REFERENCE_TYPE = 'footnoteReference';
const NOTE_TYPES = new Set(['FOOTNOTE', 'ENDNOTE']);

export function IsTipTapDocument(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: TIPTAP_DOCUMENT,
      validator: {
        validate: (value: unknown): boolean => isTipTapDocument(value),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be a valid TipTap document (type "doc", with well-formed footnote/endnote nodes: unique id, valid noteType, no nested notes)`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}

function isTipTapDocument(value: unknown): boolean {
  if (!isRecord(value) || value['type'] !== 'doc') {
    return false;
  }

  const content = value['content'];
  if (content === undefined) {
    return true;
  }
  if (!Array.isArray(content)) {
    return false;
  }

  const seenNoteIds = new Set<string>();
  return content.every((node) =>
    isValidNode(node, { insideFootnote: false, seenNoteIds }),
  );
}

function isValidNode(
  node: unknown,
  context: { insideFootnote: boolean; seenNoteIds: Set<string> },
): boolean {
  if (!isRecord(node)) {
    // Non-record children (shouldn't normally occur) are left to the rest
    // of the pipeline — this validator only enforces footnote/endnote
    // structure, not the full TipTap schema.
    return true;
  }

  if (node['type'] !== FOOTNOTE_REFERENCE_TYPE) {
    const children = node['content'];
    if (!Array.isArray(children)) {
      return true;
    }
    return children.every((child) => isValidNode(child, context));
  }

  if (context.insideFootnote) {
    // Notes cannot be nested inside another note's body.
    return false;
  }

  const attrs = node['attrs'];
  if (!isRecord(attrs)) {
    return false;
  }

  const id = attrs['id'];
  if (typeof id !== 'string' || id.length === 0) {
    return false;
  }
  if (context.seenNoteIds.has(id)) {
    return false;
  }

  const noteType = attrs['noteType'];
  if (typeof noteType !== 'string' || !NOTE_TYPES.has(noteType)) {
    return false;
  }

  context.seenNoteIds.add(id);

  const body = node['content'];
  if (body === undefined) {
    return true;
  }
  if (!Array.isArray(body)) {
    return false;
  }

  return body.every((child) =>
    isValidNode(child, { ...context, insideFootnote: true }),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
