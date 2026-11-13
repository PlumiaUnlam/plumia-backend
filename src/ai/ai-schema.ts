/**
 * Strict providers (Claude structured outputs, OpenAI-style `strict` schemas
 * through OpenRouter) require `additionalProperties: false` on every object
 * and reject numeric bounds, so those are removed.
 */
export function toClosedSchema(
  schema: Record<string, unknown>,
): Record<string, unknown> {
  return closeNode(schema) as Record<string, unknown>;
}

function closeNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(closeNode);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'minimum' || key === 'maximum') {
      continue;
    }
    result[key] = closeNode(value);
  }
  if (isObjectType(result['type'])) {
    result['additionalProperties'] = false;
  }
  return result;
}

/**
 * OpenAI-style strict mode also needs every property listed in `required`.
 * Schemas with optional fields are sent in non-strict mode and validated by
 * the use case instead.
 */
export function isStrictCompatible(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.every(isStrictCompatible);
  }
  if (!schema || typeof schema !== 'object') {
    return true;
  }
  const record = schema as Record<string, unknown>;
  if (isObjectType(record['type'])) {
    const properties = record['properties'];
    if (!properties || typeof properties !== 'object') {
      return false;
    }
    const required = new Set(
      Array.isArray(record['required'])
        ? (record['required'] as unknown[])
        : [],
    );
    if (Object.keys(properties).some((key) => !required.has(key))) {
      return false;
    }
  }
  return Object.values(record).every(isStrictCompatible);
}

function isObjectType(type: unknown): boolean {
  return type === 'object' || (Array.isArray(type) && type.includes('object'));
}

/**
 * Providers without native structured output may wrap the JSON in a code
 * fence or add text around it. Returns the JSON text to parse.
 */
export function extractJsonText(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  if (isParsable(candidate)) {
    return candidate;
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start) {
    const sliced = candidate.slice(start, end + 1);
    if (isParsable(sliced)) {
      return sliced;
    }
  }
  return candidate;
}

function isParsable(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}
