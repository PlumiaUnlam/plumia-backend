import { createHash } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SUMMARY_SCOPE, type SummaryScope } from './domain/summary-scope';
import {
  estimateTokens,
  extractNarrativeText,
  splitTextByTokenBudget,
} from './domain/text-content';
import {
  SUMMARY_GENERATION_PROVIDER,
  type SummaryGenerationProvider,
} from './ports/summary-generation-provider.port';
import { SUMMARY_QUEUE, type SummaryQueue } from './ports/summary-queue.port';
import {
  SUMMARY_REPOSITORY,
  type ChapterSummaryInput,
  type SceneSummaryInput,
  type SummaryJobRecord,
  type SummaryRecord,
  type SummaryRepository,
} from './ports/summary-repository.port';

const LEAF_TOKEN_BUDGET = 12_000;
const REDUCE_TOKEN_BUDGET = 14_000;
const MAX_PARALLEL_GENERATIONS = 2;

@Injectable()
export class SummaryService {
  constructor(
    @Inject(SUMMARY_REPOSITORY) private readonly repository: SummaryRepository,
    @Inject(SUMMARY_GENERATION_PROVIDER)
    private readonly generator: SummaryGenerationProvider,
    @Inject(SUMMARY_QUEUE) private readonly queue: SummaryQueue,
  ) {}

  async getSummary(
    userId: string,
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryRecord> {
    const summary = await this.repository.findSummary(userId, scope, scopeId);
    if (!summary) {
      throw new NotFoundException('Summary not found');
    }
    return summary;
  }

  async requestGeneration(
    userId: string,
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SummaryJobRecord> {
    const input = await this.getInputForUser(userId, scope, scopeId);
    const inputHash = this.inputHash(input, scope);
    const bullJobId = `summary-${scope}-${scopeId}-${inputHash.slice(0, 20)}`;
    const job = await this.repository.createOrGetJob({
      projectId: input.projectId,
      scope,
      scopeId,
      inputHash,
      force: true,
      bullJobId,
    });
    if (job.status === 'QUEUED') {
      await this.queue.enqueueGeneration(
        { summaryJobId: job.id, scope, scopeId, force: true },
        1,
      );
    }
    return job;
  }

  async getJob(userId: string, jobId: string): Promise<SummaryJobRecord> {
    const job = await this.repository.findJobForUser(userId, jobId);
    if (!job) {
      throw new NotFoundException('Summary job not found');
    }
    return job;
  }

  async updateManual(
    userId: string,
    summaryId: string,
    content: string,
  ): Promise<SummaryRecord> {
    const summary = await this.repository.updateManual(
      userId,
      summaryId,
      content,
    );
    if (!summary) {
      throw new NotFoundException('Summary not found');
    }
    return summary;
  }

  async processGeneration(
    jobId: string,
    scope: SummaryScope,
    scopeId: string,
    force: boolean,
  ): Promise<void> {
    await this.repository.markJobProcessing(jobId);
    try {
      const input =
        scope === SUMMARY_SCOPE.SCENE
          ? await this.repository.findSceneInputById(scopeId)
          : await this.repository.findChapterInputById(scopeId);
      if (!input) {
        throw new NotFoundException(
          `${scope === SUMMARY_SCOPE.SCENE ? 'Scene' : 'Chapter'} not found`,
        );
      }
      const current = await this.repository.findSummaryByScope(scope, scopeId);
      if (current?.source === 'author_manual' && !force) {
        await this.repository.markJobCompleted(jobId);
        return;
      }
      const result =
        scope === SUMMARY_SCOPE.SCENE
          ? await this.generateScene(input as SceneSummaryInput)
          : await this.generateChapter(input as ChapterSummaryInput);
      const fresh =
        scope === SUMMARY_SCOPE.SCENE
          ? await this.repository.findSceneInputById(scopeId)
          : await this.repository.findChapterInputById(scopeId);
      if (
        !fresh ||
        this.inputHash(fresh, scope) !== this.inputHash(input, scope)
      ) {
        throw new Error('Source changed while generating summary');
      }
      await this.repository.upsertGenerated({
        projectId: input.projectId,
        scopeType: scope,
        scopeId,
        title: input.title,
        content: result.content,
        sourceContentHash: this.inputHash(input, scope),
        provider: result.provider,
        model: result.model,
        isDirty: false,
        tokenCount: result.inputTokens + result.outputTokens,
      });
      await this.repository.markJobCompleted(jobId);
    } catch (error: unknown) {
      await this.repository.markJobFailed(
        jobId,
        error instanceof Error ? error.message : 'Summary generation failed',
      );
      throw error;
    }
  }

  async processInvalidation(sceneId: string, chapterId: string): Promise<void> {
    const affected = await this.repository.invalidateScene(sceneId, chapterId);
    for (const summary of [affected.scene, affected.chapter]) {
      if (summary?.source === 'ai_generated') {
        const input =
          summary.scopeType === SUMMARY_SCOPE.SCENE
            ? await this.repository.findSceneInputById(summary.scopeId)
            : await this.repository.findChapterInputById(summary.scopeId);
        if (!input) {
          continue;
        }
        const hash = this.inputHash(input, summary.scopeType);
        const queued = await this.repository.createOrGetJob({
          projectId: input.projectId,
          scope: summary.scopeType,
          scopeId: summary.scopeId,
          inputHash: hash,
          force: false,
          bullJobId: `summary-${summary.scopeType}-${summary.scopeId}-${hash.slice(0, 20)}`,
        });
        if (queued.status === 'QUEUED') {
          await this.queue.enqueueGeneration(
            {
              summaryJobId: queued.id,
              scope: queued.scopeType,
              scopeId: queued.scopeId,
              force: false,
            },
            10,
          );
        }
      }
    }
  }

  private async generateScene(scene: SceneSummaryInput): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
  }> {
    const text = extractNarrativeText(scene.content);
    if (!text) {
      throw new Error('Scene has no text to summarize');
    }
    return this.reduceText('scene', text, targetWords(scene.wordCount));
  }

  private async generateChapter(chapter: ChapterSummaryInput): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
  }> {
    if (chapter.scenes.length === 0) {
      throw new Error('Chapter has no scenes to summarize');
    }
    const parts: string[] = [];
    for (const scene of chapter.scenes) {
      const existing = await this.repository.findSummaryByScope(
        SUMMARY_SCOPE.SCENE,
        scene.id,
      );
      if (existing && !existing.isDirty) {
        parts.push(existing.content);
      } else {
        parts.push((await this.generateScene(scene)).content);
      }
    }
    const totalWords = chapter.scenes.reduce(
      (sum, scene) => sum + scene.wordCount,
      0,
    );
    return this.reduceText(
      'chapter',
      parts.join('\n\n'),
      targetWords(totalWords),
    );
  }

  private async reduceText(
    scope: 'scene' | 'chapter',
    text: string,
    outputWords: number,
  ): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
  }> {
    let parts = splitTextByTokenBudget(text, LEAF_TOKEN_BUDGET);
    let inputTokens = 0;
    let outputTokens = 0;
    let provider = '';
    let model = '';
    while (
      parts.length > 1 ||
      estimateTokens(parts[0] ?? '') > REDUCE_TOKEN_BUDGET
    ) {
      const chunks = splitTextByTokenBudget(
        parts.join('\n\n'),
        REDUCE_TOKEN_BUDGET,
      );
      const generated = await this.mapWithConcurrency(chunks, async (chunk) =>
        this.generateVerified({
          scope,
          text: chunk,
          targetWords: Math.max(100, Math.round(outputWords / chunks.length)),
        }),
      );
      for (const item of generated) {
        inputTokens += item.inputTokens;
        outputTokens += item.outputTokens;
        provider = item.provider;
        model = item.model;
      }
      parts = generated.map((item) => item.content);
    }
    const final = await this.generateVerified({
      scope,
      text: parts[0] ?? text,
      targetWords: outputWords,
    });
    return {
      content: final.content,
      inputTokens: inputTokens + final.inputTokens,
      outputTokens: outputTokens + final.outputTokens,
      provider: final.provider || provider,
      model: final.model || model,
    };
  }

  private async generateVerified(input: {
    scope: 'scene' | 'chapter';
    text: string;
    targetWords: number;
  }): Promise<{
    content: string;
    inputTokens: number;
    outputTokens: number;
    provider: string;
    model: string;
  }> {
    let result = await this.generator.generate(input);
    let verification = await this.generator.verify({
      scope: input.scope,
      sourceText: input.text,
      summary: result.content,
    });
    let inputTokens = result.inputTokens + verification.inputTokens;
    let outputTokens = result.outputTokens + verification.outputTokens;

    if (!verification.approved) {
      result = await this.generator.generate({
        ...input,
        revisionInstructions: verification.violations.join('\n'),
      });
      verification = await this.generator.verify({
        scope: input.scope,
        sourceText: input.text,
        summary: result.content,
      });
      inputTokens += result.inputTokens + verification.inputTokens;
      outputTokens += result.outputTokens + verification.outputTokens;
    }
    if (!verification.approved) {
      throw new Error(
        `Summary failed factual verification: ${verification.violations.join('; ')}`,
      );
    }
    return { ...result, inputTokens, outputTokens };
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    mapper: (item: T) => Promise<R>,
  ): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const worker = async (): Promise<void> => {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await mapper(items[index]!);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(MAX_PARALLEL_GENERATIONS, items.length) },
        () => worker(),
      ),
    );
    return results;
  }

  private async getInputForUser(
    userId: string,
    scope: SummaryScope,
    scopeId: string,
  ): Promise<SceneSummaryInput | ChapterSummaryInput> {
    const input =
      scope === SUMMARY_SCOPE.SCENE
        ? await this.repository.findSceneInput(userId, scopeId)
        : await this.repository.findChapterInput(userId, scopeId);
    if (!input) {
      throw new NotFoundException(
        `${scope === SUMMARY_SCOPE.SCENE ? 'Scene' : 'Chapter'} not found`,
      );
    }
    return input;
  }

  private inputHash(
    input: SceneSummaryInput | ChapterSummaryInput,
    scope: SummaryScope,
  ): string {
    const value =
      scope === SUMMARY_SCOPE.SCENE
        ? ((input as SceneSummaryInput).contentHash ??
          extractNarrativeText((input as SceneSummaryInput).content))
        : (input as ChapterSummaryInput).scenes
            .map(
              (scene) =>
                `${scene.id}:${scene.contentHash ?? extractNarrativeText(scene.content)}`,
            )
            .join('|');
    return createHash('sha256').update(value).digest('hex');
  }
}

function targetWords(sourceWords: number): number {
  return Math.min(1200, Math.max(120, Math.round(sourceWords * 0.15)));
}
