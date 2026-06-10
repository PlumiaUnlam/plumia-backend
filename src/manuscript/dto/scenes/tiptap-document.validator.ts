import {
  buildMessage,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

const TIPTAP_DOCUMENT = 'tiptapDocument';

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
            `${eachPrefix}$property must be a TipTap document with type "doc"`,
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
  return content === undefined || Array.isArray(content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
