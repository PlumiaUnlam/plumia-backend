import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { LlmRouter } from '../../ai/llm-router.service';
import { AiNotConfiguredError } from '../../ai/ai-errors';
import type { LlmJsonRequest, LlmJsonResult } from '../../ai/ai.types';
import type {
  SummaryGenerationInput,
  SummaryGenerationProvider,
  SummaryGenerationResult,
  SummaryVerificationInput,
  SummaryVerificationResult,
} from '../ports/summary-generation-provider.port';
import {
  SUMMARY_SYSTEM_PROMPT,
  VERIFIER_SYSTEM_PROMPT,
} from './summary-prompts';

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

const VERIFICATION_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean' },
    violations: { type: 'array', items: { type: 'string' } },
  },
  required: ['approved', 'violations'],
};

/**
 * Scene and chapter summaries through the LLM router (`AI_SUMMARY_CHAIN`).
 * The stored provider/model are the ones that actually answered.
 */
@Injectable()
export class AiSummaryGenerationAdapter implements SummaryGenerationProvider {
  constructor(private readonly router: LlmRouter) {}

  async generate(
    input: SummaryGenerationInput,
  ): Promise<SummaryGenerationResult> {
    const revision = input.revisionInstructions
      ? `\n\n## Required Corrections\nThe previous draft failed review. Correct every issue below without adding new information:\n${input.revisionInstructions}`
      : '';
    const result = await this.run(
      {
        schemaName: 'scene_summary',
        system: SUMMARY_SYSTEM_PROMPT,
        user: `## Assignment\nCreate a faithful Spanish summary of the following fictional ${input.scope}.\n\n## Target Length\nAim for approximately ${input.targetWords} words. Do not exceed that target by more than 15%.\n\n## Source Text\n${input.text}${revision}`,
        schema: SUMMARY_SCHEMA,
        temperature: 0.1,
      },
      (text) => {
        const summary = toRecord(JSON.parse(text))?.['summary'];
        if (typeof summary !== 'string' || !summary.trim()) {
          throw new TypeError('AI provider returned an invalid summary');
        }
        return summary.trim();
      },
    );
    return {
      content: result.value,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      provider: result.provider,
      model: result.model,
    };
  }

  async verify(
    input: SummaryVerificationInput,
  ): Promise<SummaryVerificationResult> {
    const result = await this.run(
      {
        schemaName: 'summary_verification',
        system: VERIFIER_SYSTEM_PROMPT,
        user: `## Source Text\n${input.sourceText}\n\n## Candidate Summary\n${input.summary}`,
        schema: VERIFICATION_SCHEMA,
        temperature: 0,
      },
      (text) => {
        const record = toRecord(JSON.parse(text));
        const approved = record?.['approved'];
        if (typeof approved !== 'boolean') {
          throw new TypeError(
            'AI provider returned an invalid verification result',
          );
        }
        const violations = record?.['violations'];
        return {
          approved,
          violations: Array.isArray(violations)
            ? violations.filter(
                (item): item is string =>
                  typeof item === 'string' && item.trim().length > 0,
              )
            : [],
        };
      },
    );
    return {
      ...result.value,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      provider: result.provider,
      model: result.model,
    };
  }

  private async run<T>(
    request: LlmJsonRequest,
    parse: (text: string) => T,
  ): Promise<LlmJsonResult<T>> {
    try {
      return await this.router.generateJson({
        useCase: 'summary',
        request,
        parse,
      });
    } catch (error: unknown) {
      if (error instanceof AiNotConfiguredError) {
        throw new ServiceUnavailableException(
          'No AI provider is configured for summaries',
        );
      }
      throw error;
    }
  }
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
