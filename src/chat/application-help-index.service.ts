import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { ChatSource } from './domain/chat.types';
import { isSafeChatRoute } from './domain/chat-navigation';
import {
  APPLICATION_HELP_EMBEDDING_PROVIDER,
  type ApplicationHelpEmbeddingProvider,
} from './ports/application-help-embedding-provider.port';
import {
  APPLICATION_HELP_STORE,
  type ApplicationHelpChunkInput,
  type ApplicationHelpStore,
} from './ports/application-help-store.port';
import { matchesApplicationHelpQuestion } from './domain/application-help-intent';

const EMBEDDING_BATCH_SIZE = 24;
const SEARCH_RESULT_LIMIT = 6;
const CORPUS_PATH = join(__dirname, 'data', 'application-help.jsonl');

@Injectable()
export class ApplicationHelpIndexService implements OnModuleInit {
  private readonly logger = new Logger(ApplicationHelpIndexService.name);
  private snapshotPromise: Promise<ApplicationHelpChunkInput[]> | null = null;
  private indexingPromise: Promise<void> | null = null;

  constructor(
    @Inject(APPLICATION_HELP_STORE)
    private readonly store: ApplicationHelpStore,
    @Inject(APPLICATION_HELP_EMBEDDING_PROVIDER)
    private readonly embeddingProvider: ApplicationHelpEmbeddingProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSnapshot();
    if (this.embeddingProvider.isConfigured()) {
      this.startBackgroundIndexing();
    }
  }

  async search(
    question: string,
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ChatSource[]> {
    throwIfAborted(signal);
    const snapshot = await this.ensureSnapshot();
    let embedding: number[] | undefined;
    if (this.embeddingProvider.isConfigured()) {
      try {
        embedding = await this.embeddingProvider.embedQuery(question, signal);
      } catch (error: unknown) {
        if (signal?.aborted) {
          throw createAbortError();
        }
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Application help semantic search unavailable: ${message}`,
        );
      }
    }

    throwIfAborted(signal);
    const matches = await this.store.search({
      query: question,
      profile: this.embeddingProvider.profile,
      ...(embedding ? { embedding } : {}),
      limit: SEARCH_RESULT_LIMIT,
    });
    const snapshotById = new Map(snapshot.map((chunk) => [chunk.id, chunk]));
    return matches.flatMap((match) => {
      const chunk = snapshotById.get(match.id);
      if (!chunk) {
        return [];
      }
      const route = chunk.route.replaceAll(
        '{projectId}',
        encodeURIComponent(projectId),
      );
      return [
        {
          id: `application_help:${chunk.id}`,
          kind: 'application_help',
          label: chunk.breadcrumb,
          excerpt: chunk.content,
          ...(isSafeChatRoute(route) ? { route } : {}),
        } satisfies ChatSource,
      ];
    });
  }

  async matchesApplicationHelpIntent(question: string): Promise<boolean> {
    const snapshot = await this.ensureSnapshot();
    return matchesApplicationHelpQuestion(question, snapshot);
  }

  private ensureSnapshot(): Promise<ApplicationHelpChunkInput[]> {
    this.snapshotPromise ??= this.readAndSyncSnapshot().catch(
      (error: unknown) => {
        this.snapshotPromise = null;
        throw error;
      },
    );
    return this.snapshotPromise;
  }

  private async readAndSyncSnapshot(): Promise<ApplicationHelpChunkInput[]> {
    const raw = await readFile(CORPUS_PATH, 'utf8');
    const chunks = parseSnapshot(raw);
    await this.store.syncSnapshot(chunks);
    this.logger.log(
      `Loaded ${chunks.length} PlumIA help documents into the chat index`,
    );
    return chunks;
  }

  private startBackgroundIndexing(): void {
    if (this.indexingPromise) {
      return;
    }
    this.indexingPromise = this.indexAllStaleChunks();
    void this.indexingPromise
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Application help indexing will resume on a later start: ${message}`,
        );
      })
      .finally(() => {
        this.indexingPromise = null;
      });
  }

  private async indexAllStaleChunks(): Promise<void> {
    while (true) {
      const staleChunks = await this.store.findStaleChunks(
        this.embeddingProvider.profile,
        EMBEDDING_BATCH_SIZE,
      );
      if (staleChunks.length === 0) {
        return;
      }
      const embeddings = await this.embeddingProvider.embedDocuments(
        staleChunks.map((chunk) => ({
          title: chunk.title,
          content: chunk.embedText,
        })),
      );
      if (embeddings.length !== staleChunks.length) {
        throw new Error('Embedding provider returned an incomplete help batch');
      }
      const updated = await Promise.all(
        staleChunks.map((chunk, index) => {
          const embedding = embeddings[index];
          if (!embedding) {
            throw new Error('Embedding provider returned an empty help vector');
          }
          return this.store.updateEmbedding({
            id: chunk.id,
            embedding,
            contentHash: chunk.contentHash,
            profile: this.embeddingProvider.profile,
          });
        }),
      );
      if (updated.some((didUpdate) => !didUpdate)) {
        throw new Error('Application help snapshot changed during embedding');
      }
      this.logger.log(`Embedded ${staleChunks.length} PlumIA help documents`);
    }
  }
}

interface RawHelpChunk {
  id: string;
  docId: string;
  title: string;
  breadcrumb: string;
  area: string;
  route: string;
  related: string[];
  questions: string[];
  keywords: string[];
  text: string;
  embedText: string;
  words: number;
  sources: string[];
  updated: string;
}

function parseSnapshot(raw: string): ApplicationHelpChunkInput[] {
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('Application help corpus is empty');
  }
  const ids = new Set<string>();
  return lines.map((line, index) => {
    let chunk: unknown;
    try {
      chunk = JSON.parse(line) as unknown;
    } catch {
      throw new Error(`Invalid application help JSONL at line ${index + 1}`);
    }
    if (!isRawHelpChunk(chunk)) {
      throw new Error(`Invalid application help entry at line ${index + 1}`);
    }
    if (ids.has(chunk.id)) {
      throw new Error(`Duplicate application help id: ${chunk.id}`);
    }
    const routeWithoutParameters = chunk.route.replaceAll(
      /\{[a-zA-Z][a-zA-Z0-9]*\}/g,
      'example',
    );
    if (!isSafeChatRoute(routeWithoutParameters)) {
      throw new Error(`Invalid application help route for ${chunk.id}`);
    }
    ids.add(chunk.id);
    const contentHash = createHash('sha256')
      .update(chunk.embedText)
      .digest('hex');
    return {
      id: chunk.id,
      docId: chunk.docId,
      title: chunk.title,
      breadcrumb: chunk.breadcrumb,
      area: chunk.area,
      route: chunk.route,
      related: chunk.related,
      questions: chunk.questions,
      keywords: chunk.keywords,
      content: chunk.text,
      embedText: chunk.embedText,
      words: chunk.words,
      sources: chunk.sources,
      updated: chunk.updated,
      contentHash,
    };
  });
}

function isRawHelpChunk(value: unknown): value is RawHelpChunk {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as Record<string, unknown>;
  const strings = [
    'id',
    'docId',
    'title',
    'breadcrumb',
    'area',
    'route',
    'text',
    'embedText',
    'updated',
  ];
  return (
    strings.every(
      (key) => typeof entry[key] === 'string' && entry[key].trim().length > 0,
    ) &&
    ['related', 'questions', 'keywords', 'sources'].every(
      (key) =>
        Array.isArray(entry[key]) &&
        (entry[key] as unknown[]).every((item) => typeof item === 'string'),
    ) &&
    typeof entry['words'] === 'number' &&
    Number.isInteger(entry['words']) &&
    entry['words'] > 0
  );
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function createAbortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}
