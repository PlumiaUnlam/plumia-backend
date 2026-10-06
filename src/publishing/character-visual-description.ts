interface DescriptionToken {
  value: string;
  start: number;
  end: number;
}

const VISUAL_ANCHORS = [
  'tono de piel',
  'ojo',
  'ojos',
  'mirada',
  'cabello',
  'pelo',
  'piel',
  'complexión',
  'estatura',
  'altura',
  'rostro',
  'cara',
  'barba',
  'bigote',
  'pecas',
  'canas',
  'cicatriz',
  'cicatrices',
  'vestimenta',
  'ropa',
].map((anchor) => anchor.split(' '));

const STOP_WORDS = new Set(['y', 'pero', 'aunque', 'es', 'tiene', 'conoce']);
const VISUAL_QUALIFIERS = new Set(['de', 'color', 'muy']);
const CLOTHING_ARTICLES = new Set(['un', 'una', 'unos', 'unas']);
const BODY_DESCRIPTORS = new Set([
  'alto',
  'alta',
  'bajo',
  'baja',
  'delgado',
  'delgada',
  'robusto',
  'robusta',
  'musculoso',
  'musculosa',
]);

function tokenize(description: string): DescriptionToken[] {
  return [...description.matchAll(/[\p{L}\p{M}\d-]+/gu)].map((match) => {
    const value = match[0];
    const start = match.index ?? 0;
    return { value: value.toLowerCase(), start, end: start + value.length };
  });
}

function hasWhitespaceBetween(
  description: string,
  left: DescriptionToken,
  right: DescriptionToken,
): boolean {
  const separator = description.slice(left.end, right.start);
  return separator.length > 0 && separator.trim().length === 0;
}

function isAnchorAt(
  description: string,
  tokens: DescriptionToken[],
  start: number,
  anchor: string[],
): boolean {
  if (start + anchor.length > tokens.length) {
    return false;
  }

  for (let offset = 0; offset < anchor.length; offset += 1) {
    const token = tokens[start + offset];
    if (!token || token.value !== anchor[offset]) {
      return false;
    }
    if (offset === 0) {
      continue;
    }

    const previous = tokens[start + offset - 1];
    if (!previous || !hasWhitespaceBetween(description, previous, token)) {
      return false;
    }
  }
  return true;
}

function matchesAnchor(
  description: string,
  tokens: DescriptionToken[],
  start: number,
): number {
  for (const anchor of VISUAL_ANCHORS) {
    if (isAnchorAt(description, tokens, start, anchor)) {
      return anchor.length;
    }
  }
  return 0;
}

function wordsAfterAnchor(
  description: string,
  tokens: DescriptionToken[],
  anchorStart: number,
  anchorLength: number,
): { text: string; lastIndex: number } | null {
  const anchorEnd = anchorStart + anchorLength - 1;
  const anchorToken = tokens[anchorEnd];
  let valueStart = anchorEnd + 1;
  const firstValue = tokens[valueStart];
  if (
    !anchorToken ||
    !firstValue ||
    !hasWhitespaceBetween(description, anchorToken, firstValue)
  ) {
    return null;
  }

  const qualifierNext = tokens[valueStart + 1];
  if (
    VISUAL_QUALIFIERS.has(firstValue.value) &&
    qualifierNext &&
    hasWhitespaceBetween(description, firstValue, qualifierNext) &&
    !STOP_WORDS.has(qualifierNext.value)
  ) {
    valueStart += 1;
  }

  const valueToken = tokens[valueStart];
  if (!valueToken || STOP_WORDS.has(valueToken.value)) {
    return null;
  }

  let lastIndex = valueStart;
  let count = 1;
  while (count < 3) {
    const current = tokens[lastIndex];
    const next = tokens[lastIndex + 1];
    if (
      !current ||
      !next ||
      !hasWhitespaceBetween(description, current, next) ||
      STOP_WORDS.has(next.value)
    ) {
      break;
    }
    lastIndex += 1;
    count += 1;
  }

  const first = tokens[anchorStart];
  const last = tokens[lastIndex];
  if (!first || !last) {
    return null;
  }
  return {
    text: description.slice(first.start, last.end).trim(),
    lastIndex,
  };
}

function extractAnchoredTraits(
  description: string,
  tokens: DescriptionToken[],
): string[] {
  const matches: string[] = [];
  let lastConsumedIndex = -1;
  for (const [index] of tokens.entries()) {
    if (index <= lastConsumedIndex) {
      continue;
    }

    const anchorLength = matchesAnchor(description, tokens, index);
    if (!anchorLength) {
      continue;
    }

    const match = wordsAfterAnchor(description, tokens, index, anchorLength);
    if (!match) {
      continue;
    }
    matches.push(match.text);
    lastConsumedIndex = match.lastIndex;
  }
  return matches;
}

function wordsAfterClothingVerb(
  description: string,
  tokens: DescriptionToken[],
  verbIndex: number,
): { text: string; lastIndex: number } | null {
  const verb = tokens[verbIndex];
  let valueStart = verbIndex + 1;
  const firstValue = tokens[valueStart];
  if (
    !verb ||
    !firstValue ||
    !hasWhitespaceBetween(description, verb, firstValue)
  ) {
    return null;
  }

  const afterArticle = tokens[valueStart + 1];
  if (
    CLOTHING_ARTICLES.has(firstValue.value) &&
    afterArticle &&
    hasWhitespaceBetween(description, firstValue, afterArticle)
  ) {
    valueStart += 1;
  }

  let lastIndex = valueStart;
  let followingWords = 0;
  while (followingWords < 3) {
    const current = tokens[lastIndex];
    const next = tokens[lastIndex + 1];
    if (
      !current ||
      !next ||
      !hasWhitespaceBetween(description, current, next) ||
      STOP_WORDS.has(next.value)
    ) {
      break;
    }
    lastIndex += 1;
    followingWords += 1;
  }

  const first = tokens[verbIndex];
  const last = tokens[lastIndex];
  if (!first || !last) {
    return null;
  }
  return {
    text: description.slice(first.start, last.end).trim(),
    lastIndex,
  };
}

function extractClothingTraits(
  description: string,
  tokens: DescriptionToken[],
): string[] {
  const matches: string[] = [];
  let lastConsumedIndex = -1;
  for (const [index] of tokens.entries()) {
    if (index <= lastConsumedIndex) {
      continue;
    }

    const token = tokens[index];
    if (!token || (token.value !== 'viste' && token.value !== 'lleva')) {
      continue;
    }

    const match = wordsAfterClothingVerb(description, tokens, index);
    if (!match) {
      continue;
    }
    matches.push(match.text);
    lastConsumedIndex = match.lastIndex;
  }
  return matches;
}

function extractBodyTraits(
  description: string,
  tokens: DescriptionToken[],
): string[] {
  const matches: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const verb = tokens[index];
    if (!verb || (verb.value !== 'es' && verb.value !== 'mide')) {
      continue;
    }

    const descriptor = tokens[index + 1];
    if (!descriptor || !hasWhitespaceBetween(description, verb, descriptor)) {
      continue;
    }

    if (BODY_DESCRIPTORS.has(descriptor.value)) {
      matches.push(description.slice(verb.start, descriptor.end).trim());
      continue;
    }

    const height = /^\s+(\d+(?:[,.]\d+)?\s*(?:cm|m)\b)/iu.exec(
      description.slice(verb.end),
    );
    if (height) {
      const heightEnd = verb.end + height[0].trimEnd().length;
      matches.push(description.slice(verb.start, heightEnd).trim());
    }
  }
  return matches;
}

export function extractCharacterVisualDescription(
  description: string | null,
): string {
  if (!description?.trim()) {
    return '';
  }

  const tokens = tokenize(description);
  const matches = [
    ...extractAnchoredTraits(description, tokens),
    ...extractClothingTraits(description, tokens),
    ...extractBodyTraits(description, tokens),
  ];
  return [...new Set(matches)].join(', ');
}
