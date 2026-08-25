import type { ChatGenerationResult } from '../ports/chat-generation-provider.port';
import type { ChatSource } from './chat.types';

const SAFE_UNGROUNDED_ANSWER =
  'No pude respaldar una respuesta con referencias de tu manuscrito, Wiki o linea de tiempo. Prefiero no afirmar algo que la obra no demuestra.';

export function buildGroundedResponse(
  result: ChatGenerationResult,
  availableSources: ChatSource[],
): { answer: string; sources: ChatSource[] } {
  const sourceById = new Map(
    availableSources.map((source) => [source.id, source]),
  );

  const usedSources: ChatSource[] = [];
  const citationBySourceId = new Map<string, number>();
  const renderedClaims: string[] = [];
  if (result.claims.length === 0) {
    return ungroundedResponse();
  }

  for (const claim of result.claims) {
    if (!claim.text.trim() || claim.evidence.length === 0) {
      return ungroundedResponse();
    }
    const claimSources: ChatSource[] = [];
    for (const evidence of claim.evidence) {
      const source = sourceById.get(evidence.sourceId);
      if (!source || !sourceContainsQuote(source, evidence.quote)) {
        return ungroundedResponse();
      }
      if (!claimSources.some((candidate) => candidate.id === source.id)) {
        claimSources.push(source);
      }
    }
    const citationNumbers = claimSources.map((source) => {
      const existing = citationBySourceId.get(source.id);
      if (existing !== undefined) {
        return existing;
      }
      usedSources.push(source);
      const citationNumber = usedSources.length;
      citationBySourceId.set(source.id, citationNumber);
      return citationNumber;
    });
    renderedClaims.push(`${claim.text.trim()} [${citationNumbers.join(', ')}]`);
  }
  return { answer: renderedClaims.join('\n\n'), sources: usedSources };
}

function sourceContainsQuote(source: ChatSource, quote: string): boolean {
  const normalizedQuote = normalizeGroundingText(quote)
    .replace(/\s+/g, ' ')
    .trim();
  if (normalizedQuote.length < 8) {
    return false;
  }
  return normalizeGroundingText(source.excerpt)
    .replace(/\s+/g, ' ')
    .includes(normalizedQuote);
}

function ungroundedResponse(): { answer: string; sources: ChatSource[] } {
  return { answer: SAFE_UNGROUNDED_ANSWER, sources: [] };
}

function normalizeGroundingText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
