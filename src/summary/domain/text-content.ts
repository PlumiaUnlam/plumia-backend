export function extractNarrativeText(content: unknown): string {
  const parts: string[] = [];
  visit(content, parts);
  return parts
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function visit(value: unknown, parts: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visit(item, parts));
    return;
  }

  if (value === null || typeof value !== 'object') {
    return;
  }

  const node = value as Record<string, unknown>;
  if (typeof node['text'] === 'string') {
    parts.push(node['text']);
  }
  if (node['type'] === 'paragraph' || node['type'] === 'heading') {
    parts.push('\n');
  }
  if (node['content'] !== undefined) {
    visit(node['content'], parts);
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function splitTextByTokenBudget(text: string, budget: number): string[] {
  if (estimateTokens(text) <= budget) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const paragraphParts = splitOversizedText(paragraph, budget);
    for (const part of paragraphParts) {
      const candidate = current ? `${current}\n\n${part}` : part;
      if (current && estimateTokens(candidate) > budget) {
        chunks.push(current);
        current = part;
      } else {
        current = candidate;
      }
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function splitOversizedText(text: string, budget: number): string[] {
  if (estimateTokens(text) <= budget) {
    return [text];
  }

  const units = splitIntoSentenceUnits(text);
  const chunks: string[] = [];
  let current = '';

  for (const unit of units) {
    if (estimateTokens(unit) > budget) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      chunks.push(...splitByCharacterBudget(unit, budget));
      continue;
    }
    const candidate = `${current}${unit}`;
    if (current && estimateTokens(candidate) > budget) {
      chunks.push(current.trim());
      current = unit;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }
  return chunks;
}

function splitIntoSentenceUnits(text: string): string[] {
  const units: string[] = [];
  let start = 0;
  const sentenceBoundary = /[.!?]\s*/g;
  let match: RegExpExecArray | null;

  while ((match = sentenceBoundary.exec(text)) !== null) {
    const end = match.index + match[0].length;
    units.push(text.slice(start, end));
    start = end;
  }

  if (start < text.length) {
    units.push(text.slice(start));
  }
  return units.length > 0 ? units : [text];
}

function splitByCharacterBudget(text: string, budget: number): string[] {
  const maxCharacters = Math.max(1, budget * 4);
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > maxCharacters) {
    const boundary = Math.max(
      remaining.lastIndexOf(' ', maxCharacters),
      remaining.lastIndexOf('\n', maxCharacters),
    );
    const end = boundary > 0 ? boundary : maxCharacters;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}
