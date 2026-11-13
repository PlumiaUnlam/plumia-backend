import type { ChatGenerationResult } from '../ports/chat-generation-provider.port';
import type { ChatSource } from './chat.types';

const SAFE_UNGROUNDED_ANSWER =
  'No puedo responder eso con seguridad: no pude respaldarlo con referencias de tu manuscrito, Wiki o linea de tiempo. Prefiero no afirmar algo que la obra no demuestra.';
const SAFE_UNGROUNDED_HELP_ANSWER =
  'No puedo responder eso con seguridad: no pude respaldarlo con referencias de la documentación de PlumIA. Prefiero no afirmar algo que la guía no confirma.';

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
  const fallbackAnswer =
    availableSources.length > 0 &&
    availableSources.every((source) => source.kind === 'application_help')
      ? SAFE_UNGROUNDED_HELP_ANSWER
      : SAFE_UNGROUNDED_ANSWER;
  if (result.claims.length === 0) {
    return ungroundedResponse(fallbackAnswer);
  }

  for (const claim of result.claims) {
    if (!claim.text.trim() || claim.evidence.length === 0) {
      return ungroundedResponse(fallbackAnswer);
    }
    const claimSources: ChatSource[] = [];
    for (const evidence of claim.evidence) {
      const source = sourceById.get(evidence.sourceId);
      if (!source || !sourceContainsQuote(source, evidence.quote)) {
        return ungroundedResponse(fallbackAnswer);
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

/**
 * Models often garble the long UUID of a source id when copying it. When the
 * quote is still literal text of a retrieved source, the citation is reattached
 * to that source; grounding is unchanged because the quote must still appear
 * verbatim in a retrieved source. Quotes found nowhere are left untouched so
 * they are rejected as before.
 */
export function repairEvidenceSources(
  result: ChatGenerationResult,
  availableSources: ChatSource[],
): ChatGenerationResult {
  const sourceById = new Map(
    availableSources.map((source) => [source.id, source]),
  );
  let changed = false;
  const claims = result.claims.map((claim) => ({
    ...claim,
    evidence: claim.evidence.map((evidence) => {
      const cited = sourceById.get(evidence.sourceId);
      if (cited && sourceContainsQuote(cited, evidence.quote)) {
        return evidence;
      }
      const candidates = availableSources.filter((source) =>
        sourceContainsQuote(source, evidence.quote),
      );
      const best = pickClosestSource(candidates, evidence.sourceId);
      if (!best) {
        return evidence;
      }
      changed = true;
      return { ...evidence, sourceId: best.id };
    }),
  }));
  return changed ? { ...result, claims } : result;
}

/** Among sources that contain the quote, prefers the id most similar to the cited one. */
function pickClosestSource(
  candidates: ChatSource[],
  citedId: string,
): ChatSource | null {
  let best: ChatSource | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    let shared = 0;
    while (
      shared < candidate.id.length &&
      shared < citedId.length &&
      candidate.id[candidate.id.length - 1 - shared] ===
        citedId[citedId.length - 1 - shared]
    ) {
      shared += 1;
    }
    if (shared > bestScore) {
      best = candidate;
      bestScore = shared;
    }
  }
  return best;
}

/** Human-readable reasons why `buildGroundedResponse` would reject the answer. */
export function describeGroundingProblems(
  result: ChatGenerationResult,
  availableSources: ChatSource[],
): string[] {
  const sourceById = new Map(
    availableSources.map((source) => [source.id, source]),
  );
  const problems: string[] = [];
  result.claims.forEach((claim, index) => {
    const label = `Afirmacion ${index + 1}`;
    if (!claim.text.trim() || claim.evidence.length === 0) {
      problems.push(`${label}: no tiene evidencia`);
      return;
    }
    for (const evidence of claim.evidence) {
      const source = sourceById.get(evidence.sourceId);
      if (!source) {
        problems.push(
          `${label}: el sourceId "${evidence.sourceId.slice(0, 80)}" no existe entre las fuentes recuperadas`,
        );
      } else if (!sourceContainsQuote(source, evidence.quote)) {
        problems.push(
          `${label}: la quote no aparece literal en ${evidence.sourceId}`,
        );
      }
    }
  });
  return problems.slice(0, 6);
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

function ungroundedResponse(answer: string): {
  answer: string;
  sources: ChatSource[];
} {
  return { answer, sources: [] };
}

function normalizeGroundingText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
