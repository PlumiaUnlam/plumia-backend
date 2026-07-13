import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  SummaryGenerationInput,
  SummaryGenerationProvider,
  SummaryGenerationResult,
  SummaryVerificationInput,
  SummaryVerificationResult,
} from '../ports/summary-generation-provider.port';

const TIMEOUT_MS = 30_000;
const FALLBACK_STATUS_CODES = new Set([403, 404, 408, 429, 500, 502, 503, 504]);

@Injectable()
export class GeminiSummaryGenerationAdapter implements SummaryGenerationProvider {
  private readonly apiKey: string;
  private readonly models: string[];

  constructor(config: ConfigService) {
    this.apiKey = config.get<string>('GEMINI_API_KEY') ?? '';
    const configuredModels = config.get<string>('GEMINI_SUMMARY_MODELS');
    const primaryModel =
      config.get<string>('GEMINI_SUMMARY_MODEL') ?? 'gemini-3.1-flash-lite';
    this.models = (configuredModels ?? `${primaryModel},gemini-3.5-flash`)
      .split(',')
      .map((model) => model.trim())
      .filter(
        (model, index, models) =>
          model.length > 0 && models.indexOf(model) === index,
      );
  }

  async generate(
    input: SummaryGenerationInput,
  ): Promise<SummaryGenerationResult> {
    const response = await this.requestJson<{ summary?: unknown }>(
      buildSummaryRequest(input),
    );
    const summary = response.value.summary;
    if (typeof summary !== 'string' || !summary.trim()) {
      throw new Error('Gemini API returned invalid summary');
    }
    return {
      content: summary.trim(),
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      provider: 'gemini',
      model: response.model,
    };
  }

  async verify(
    input: SummaryVerificationInput,
  ): Promise<SummaryVerificationResult> {
    const response = await this.requestJson<{
      approved?: unknown;
      violations?: unknown;
    }>(buildVerificationRequest(input));
    if (typeof response.value.approved !== 'boolean') {
      throw new Error('Gemini API returned invalid verification result');
    }
    const violations = Array.isArray(response.value.violations)
      ? response.value.violations.filter(
          (item): item is string =>
            typeof item === 'string' && item.trim().length > 0,
        )
      : [];
    return {
      approved: response.value.approved,
      violations,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      provider: 'gemini',
      model: response.model,
    };
  }

  private async requestJson<T>(request: GeminiRequest): Promise<{
    value: T;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }> {
    if (!this.apiKey) {
      throw new ServiceUnavailableException('GEMINI_API_KEY is not configured');
    }
    const failures: string[] = [];
    for (const [index, model] of this.models.entries()) {
      try {
        return await this.requestModel<T>(model, request);
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        failures.push(`${model}: ${message}`);
        if (!shouldTryFallback(error)) {
          throw error;
        }
        if (index === this.models.length - 1) {
          break;
        }
      }
    }
    throw new Error(
      `No configured Gemini summary model was available. ${failures.join(' | ')}`,
    );
  }

  private async requestModel<T>(
    model: string,
    request: GeminiRequest,
  ): Promise<{
    value: T;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': this.apiKey,
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 1_000);
        throw new GeminiApiError(
          response.status,
          `Gemini API error: ${response.status}${detail ? ` - ${detail}` : ''}`,
        );
      }

      const payload = (await response.json()) as GeminiResponse;
      const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini API returned no content');
      }
      return {
        value: JSON.parse(text) as T,
        inputTokens: payload.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata?.candidatesTokenCount ?? 0,
        model,
      };
    } catch (error: unknown) {
      if (error instanceof SyntaxError) {
        throw new Error('Gemini API returned invalid JSON');
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new GeminiApiError(408, 'Gemini API timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

interface GeminiRequest {
  systemInstruction: { parts: Array<{ text: string }> };
  contents: Array<{ parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature: number;
    responseMimeType: 'application/json';
    responseSchema: Record<string, unknown>;
  };
}

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

class GeminiApiError extends Error {
  constructor(
    readonly status: number,
    message = `Gemini API error: ${status}`,
  ) {
    super(message);
  }
}

function shouldTryFallback(error: unknown): boolean {
  return (
    error instanceof GeminiApiError && FALLBACK_STATUS_CODES.has(error.status)
  );
}

function buildSummaryRequest(input: SummaryGenerationInput): GeminiRequest {
  const revision = input.revisionInstructions
    ? `\n\n## Required Corrections\nThe previous draft failed review. Correct every issue below without adding new information:\n${input.revisionInstructions}`
    : '';
  return {
    systemInstruction: { parts: [{ text: SUMMARY_SYSTEM_PROMPT }] },
    contents: [
      {
        parts: [
          {
            text: `## Assignment\nCreate a faithful Spanish summary of the following fictional ${input.scope}.\n\n## Target Length\nAim for approximately ${input.targetWords} words. Do not exceed that target by more than 15%.\n\n## Source Text\n${input.text}${revision}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: { summary: { type: 'STRING' } },
        required: ['summary'],
      },
    },
  };
}

function buildVerificationRequest(
  input: SummaryVerificationInput,
): GeminiRequest {
  return {
    systemInstruction: { parts: [{ text: VERIFIER_SYSTEM_PROMPT }] },
    contents: [
      {
        parts: [
          {
            text: `## Source Text\n${input.sourceText}\n\n## Candidate Summary\n${input.summary}`,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          approved: { type: 'BOOLEAN' },
          violations: { type: 'ARRAY', items: { type: 'STRING' } },
        },
        required: ['approved', 'violations'],
      },
    },
  };
}

const SUMMARY_SYSTEM_PROMPT = `# Role
You are a meticulous literary editor producing factual, source-grounded summaries of fiction.

# Objective
Create a clear Spanish narrative summary that preserves only what the source text establishes. The summary must help a reader understand what happens, why it matters, and which explicitly stated conflicts remain open.

# Required Workflow
1. Read the complete source before drafting.
2. Identify explicit events, named characters, locations, actions, stated motives, causal links, changes, and unresolved conflicts.
3. Distinguish facts from possibilities, memories, beliefs, metaphors, atmosphere, and reader inference.
4. Draft a concise chronological synthesis using only supported facts.
5. Before responding, check every statement against the source and remove anything unsupported.

# Fidelity Constraints
- Never invent, predict, continue, complete, or foreshadow events beyond the source.
- Never state that an event happened when the text only suggests, fears, remembers, imagines, or questions it.
- Preserve names, titles, places, quoted terms, relationships, and chronology exactly as written; do not rename, merge, or normalize them.
- Do not add motivations, identities, emotions, causes, outcomes, themes, interpretations, or conclusions unless explicitly established.
- Do not turn symbolism, legend, rumor, or speculation into fact.
- Do not use outside knowledge or assumptions about genre conventions.
- If a detail is uncertain or unsupported, omit it rather than hedging or guessing.

# Output Rules
- Write the summary in Spanish.
- Use neutral, precise prose; do not evaluate the writing or address the reader.
- Return only the JSON object required by the schema.`;

const VERIFIER_SYSTEM_PROMPT = `# Role
You are a strict factual-faithfulness auditor for Spanish fiction summaries.

# Objective
Determine whether the candidate summary is fully supported by the supplied source text. Your task is validation, not creative interpretation and not rewriting.

# Required Workflow
1. Read the full source text and candidate summary.
2. Check each factual claim in the summary against the source.
3. Verify names, entities, chronology, actions, causes, motives, consequences, and unresolved conflicts.
4. Mark the summary as rejected if any claim is invented, altered, overgeneralized into a fact, or refers to events outside the source.
5. Provide concise, actionable correction instructions for every violation.

# Rejection Criteria
Reject when the summary adds or changes any event, character detail, identity, location, motive, causal relation, emotional state, result, future development, or conflict not explicitly established in the source. Reject when a possibility, memory, legend, metaphor, or inference is presented as fact. Reject changed names or chronology.

# Approval Criteria
Approve only if every factual claim is supported by the source. Stylistic omissions are acceptable as long as no unsupported claim is introduced.

# Output Rules
- Return only the JSON object required by the schema.
- Set approved to true only when there are no violations.
- When approved is true, return an empty violations array.
- When rejected, each violation must identify the unsupported or altered claim and state how to correct it without inventing information.`;
