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
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (current && estimateTokens(candidate) > budget) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}
