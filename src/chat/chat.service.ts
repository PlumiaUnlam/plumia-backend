/* eslint-disable max-lines */

import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ChatEmbeddingIndexService } from './chat-embedding-index.service';
import { getApplicationGuidance } from './domain/application-guide';
import {
  getPolicyRefusal,
  getSocialResponse,
  isCreativeRequest,
} from './domain/chat-policy';
import { buildGroundedResponse } from './domain/grounded-response';
import type {
  ChatExchange,
  ChatAction,
  ChatMessageRecord,
  ChatSource,
  ChatThreadPageRecord,
  ChatThreadRecord,
} from './domain/chat.types';
import {
  CHAT_GENERATION_PROVIDER,
  type ChatGenerationProvider,
  type ChatHistoryEntry,
} from './ports/chat-generation-provider.port';
import { VECTOR_STORE } from './ports/vector-store.port';
import type {
  VectorSearchResult,
  VectorStore,
} from './ports/vector-store.port';

const MAX_HISTORY_MESSAGES = 10;
const MAX_MANUSCRIPT_SOURCES = 14;
const MAX_WIKI_SOURCES = 10;
const MAX_TIMELINE_SOURCES = 20;
const MAX_CHUNK_CANDIDATES = 200;
const MAX_CONTEXT_CHARS = 48_000;

const TIMELINE_GENERIC_TERMS = new Set([
  'cronologia',
  'evento',
  'eventos',
  'fecha',
  'fechas',
  'hechos',
  'importantes',
  'linea',
  'registra',
  'registrados',
  'temporal',
  'tiempo',
]);
const STOP_WORDS = new Set([
  'a',
  'al',
  'algo',
  'antes',
  'aqui',
  'como',
  'con',
  'cual',
  'cuando',
  'cuantas',
  'cuantos',
  'de',
  'del',
  'dia',
  'dias',
  'donde',
  'el',
  'ella',
  'en',
  'entre',
  'era',
  'es',
  'esta',
  'este',
  'fue',
  'gracias',
  'hay',
  'hola',
  'holi',
  'la',
  'las',
  'lo',
  'los',
  'me',
  'mi',
  'mencion',
  'mencione',
  'menciono',
  'nota',
  'notas',
  'obra',
  'para',
  'paso',
  'por',
  'primera',
  'que',
  'quien',
  'segun',
  'se',
  'sobre',
  'su',
  'sus',
  'un',
  'una',
  'veces',
  'y',
  'ya',
]);

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CHAT_GENERATION_PROVIDER)
    private readonly generator: ChatGenerationProvider,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    private readonly embeddingIndex: ChatEmbeddingIndexService,
  ) {}

  searchSimilarChunks(
    projectId: string,
    embedding: number[],
    limit = 8,
  ): Promise<VectorSearchResult[]> {
    return this.vectorStore.search({ projectId, embedding, limit });
  }

  async createThread(
    userId: string,
    projectId: string,
    input: { title?: string },
  ): Promise<ChatThreadRecord> {
    await this.assertProjectAccess(userId, projectId);
    const normalizedTitle = input.title?.trim();
    return this.prisma.chatThread.create({
      data: {
        projectId,
        title:
          normalizedTitle && normalizedTitle.length > 0
            ? normalizedTitle
            : 'Nueva conversacion',
      },
    });
  }

  async listThreads(
    userId: string,
    projectId: string,
    input: { page: number; pageSize: number; search?: string },
  ): Promise<ChatThreadPageRecord> {
    await this.assertProjectAccess(userId, projectId);
    const search = input.search?.trim();
    const where: Prisma.ChatThreadWhereInput = {
      projectId,
      isArchived: false,
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' } },
              {
                messages: {
                  some: { content: { contains: search, mode: 'insensitive' } },
                },
              },
            ],
          }
        : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.chatThread.count({ where }),
      this.prisma.chatThread.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return {
      items,
      page: input.page,
      pageSize: input.pageSize,
      total,
      hasMore: input.page * input.pageSize < total,
    };
  }

  async listMessages(
    userId: string,
    threadId: string,
  ): Promise<ChatMessageRecord[]> {
    await this.getThreadForUser(userId, threadId);
    const messages = await this.prisma.chatMessage.findMany({
      where: { threadId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return messages.map((message) => this.toMessageRecord(message));
  }

  async updateThread(
    userId: string,
    threadId: string,
    input: {
      title?: string;
      isArchived?: boolean;
    },
  ): Promise<ChatThreadRecord> {
    await this.getThreadForUser(userId, threadId);
    return this.prisma.chatThread.update({
      where: { id: threadId },
      data: {
        ...(input.title === undefined ? {} : { title: input.title.trim() }),
        ...(input.isArchived === undefined
          ? {}
          : { isArchived: input.isArchived }),
      },
    });
  }

  async deleteThread(userId: string, threadId: string): Promise<void> {
    await this.getThreadForUser(userId, threadId);
    await this.prisma.chatThread.delete({ where: { id: threadId } });
  }

  async sendMessage(
    userId: string,
    threadId: string,
    input: { content: string },
  ): Promise<ChatExchange> {
    const thread = await this.getThreadForUser(userId, threadId);
    if (thread.isArchived) {
      throw new BadRequestException(
        'Archived chat threads cannot receive new messages',
      );
    }
    const question = input.content.trim();
    if (!question) {
      throw new BadRequestException('Chat message cannot be empty');
    }
    const historyRows = await this.prisma.chatMessage.findMany({
      where: { threadId, role: { in: ['user', 'assistant'] } },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const history = historyRows.reverse().map((message) => ({
      role: message.role as ChatHistoryEntry['role'],
      content: message.content,
    }));

    const policyRefusal = getPolicyRefusal(question);
    if (policyRefusal) {
      return this.persistExchange(thread, question, {
        answer: policyRefusal,
        sources: [],
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    const applicationGuidance = getApplicationGuidance(
      question,
      thread.projectId,
      { history },
    );
    if (applicationGuidance) {
      return this.persistExchange(thread, question, {
        answer: applicationGuidance.answer,
        sources: [],
        actions: [applicationGuidance.action],
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    const socialResponse = getSocialResponse(question);
    if (socialResponse) {
      return this.persistExchange(thread, question, {
        answer: socialResponse,
        sources: [],
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    if (isCreativeRequest(question)) {
      return this.persistExchange(thread, question, {
        answer:
          'Puedo ayudarte a consultar y auditar tu obra, pero no escribir, continuar ni autocompletar el manuscrito. Tu voz y tus decisiones creativas siguen siendo exclusivamente tuyas.',
        sources: [],
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    const sources = await this.retrieveSources(
      thread.projectId,
      question,
      history,
    );
    if (sources.length === 0) {
      return this.persistExchange(thread, question, {
        answer:
          'No encontre informacion suficiente en el manuscrito, la Wiki ni la linea de tiempo para responder con seguridad.',
        sources: [],
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    const deterministicAnswer = buildDeterministicEvidenceAnswer(
      question,
      sources,
    );
    if (deterministicAnswer) {
      return this.persistExchange(thread, question, {
        answer: deterministicAnswer.answer,
        sources: deterministicAnswer.sources,
        inputTokens: 0,
        outputTokens: 0,
      });
    }

    const result = await this.generator.generate({
      question,
      history,
      sources,
    });
    const groundedResponse = buildGroundedResponse(result, sources);

    return this.persistExchange(thread, question, {
      answer: groundedResponse.answer,
      sources: groundedResponse.sources,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
  }

  private async persistExchange(
    thread: ChatThreadRecord,
    question: string,
    response: {
      answer: string;
      sources: ChatSource[];
      actions?: ChatAction[];
      inputTokens: number;
      outputTokens: number;
    },
  ): Promise<ChatExchange> {
    const userCreatedAt = new Date();
    const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
    const [userMessage, assistantMessage] = await this.prisma.$transaction(
      async (tx) => {
        const existingMessageCount = await tx.chatMessage.count({
          where: { threadId: thread.id },
        });
        const user = await tx.chatMessage.create({
          data: {
            threadId: thread.id,
            role: 'user',
            content: question,
            createdAt: userCreatedAt,
          },
        });
        const assistant = await tx.chatMessage.create({
          data: {
            threadId: thread.id,
            role: 'assistant',
            content: response.answer,
            sources: response.sources as unknown as Prisma.InputJsonValue,
            actions: (response.actions ??
              []) as unknown as Prisma.InputJsonValue,
            inputTokens: response.inputTokens,
            outputTokens: response.outputTokens,
            createdAt: assistantCreatedAt,
          },
        });
        await tx.chatThread.update({
          where: { id: thread.id },
          data: {
            ...(existingMessageCount === 0
              ? { title: question.slice(0, 197) }
              : {}),
          },
        });
        return [user, assistant] as const;
      },
    );
    return {
      userMessage: this.toMessageRecord(userMessage),
      assistantMessage: this.toMessageRecord(assistantMessage),
    };
  }

  private async retrieveSources(
    projectId: string,
    question: string,
    history: ChatHistoryEntry[],
  ): Promise<ChatSource[]> {
    const historyQuery = history
      .filter((message) => message.role === 'user')
      .slice(-2)
      .map((message) => message.content)
      .join(' ');
    const terms = extractSearchTerms(`${question} ${historyQuery}`);
    const countTerm = extractCountTerm(question);
    const normalizedQuestion = normalize(question);
    const firstMentionIntent = /\b(primera|primer)\b/.test(normalizedQuestion);
    const timelineIntent =
      /\b(linea de tiempo|cronolog|evento|eventos|fecha|fechas|dia)\b/.test(
        normalizedQuestion,
      );
    const broadTimelineIntent =
      timelineIntent && terms.every((term) => TIMELINE_GENERIC_TERMS.has(term));
    const genericWikiIntent =
      /\b(wiki|ficha|fichas|personaje|personajes|entidad|entidades|relacion|relaciones|imagen|imagenes|protagonista)\b/.test(
        normalizedQuestion,
      );
    const semanticMatches = await this.embeddingIndex.search(
      projectId,
      question,
    );
    const semanticChunkIds = semanticMatches.map((match) => match.chunkId);
    const semanticRanks = new Map(
      semanticMatches.map((match, index) => [match.chunkId, index]),
    );
    const chunkTextTerms = (countTerm ? [countTerm] : terms).slice(0, 10);
    const chunkCandidateFilters = [
      ...(semanticChunkIds.length > 0
        ? [{ id: { in: semanticChunkIds } }]
        : []),
      ...chunkTextTerms.map((term) => ({
        content: { contains: term, mode: 'insensitive' as const },
      })),
    ];
    const scopedTerms = terms.slice(0, 10);
    const timelineCandidateFilters = scopedTerms.flatMap((term) => [
      { title: { contains: term, mode: 'insensitive' as const } },
      { description: { contains: term, mode: 'insensitive' as const } },
      { date: { contains: term, mode: 'insensitive' as const } },
      { temporalLabel: { contains: term, mode: 'insensitive' as const } },
      {
        entities: {
          some: {
            entity: {
              canonicalName: {
                contains: term,
                mode: 'insensitive' as const,
              },
            },
          },
        },
      },
    ]);
    const [chunks, entities, relationships, timelineEvents] = await Promise.all(
      [
        this.prisma.chunk.findMany({
          where: {
            projectId,
            scene: {
              deletedAt: null,
              chapter: { deletedAt: null, book: { deletedAt: null } },
            },
            ...(chunkCandidateFilters.length > 0
              ? { OR: chunkCandidateFilters }
              : {}),
          },
          include: {
            scene: { include: { chapter: { include: { book: true } } } },
          },
          ...(countTerm || firstMentionIntent
            ? {}
            : { take: MAX_CHUNK_CANDIDATES }),
        }),
        this.prisma.entity.findMany({
          where: { projectId, deletedAt: null, isActive: true },
          include: {
            facts: {
              where: { isRetconned: false },
              include: {
                sourceScene: {
                  include: { chapter: { include: { book: true } } },
                },
              },
            },
            states: {
              include: {
                validFromScene: {
                  include: { chapter: { include: { book: true } } },
                },
              },
            },
          },
          take: 200,
        }),
        this.prisma.relationship.findMany({
          where: { projectId },
          include: {
            sourceEntity: true,
            targetEntity: true,
            validFromScene: {
              include: { chapter: { include: { book: true } } },
            },
          },
        }),
        this.prisma.timelineEvent.findMany({
          where: {
            projectId,
            deletedAt: null,
            ...(!broadTimelineIntent && timelineCandidateFilters.length > 0
              ? { OR: timelineCandidateFilters }
              : {}),
          },
          include: {
            entities: { include: { entity: true } },
            sourceScene: {
              include: { chapter: { include: { book: true } } },
            },
          },
          orderBy: { position: 'asc' },
        }),
      ],
    );

    const manuscriptSources = rankManuscriptSources(
      chunks,
      terms,
      countTerm,
      question,
      semanticRanks,
    );

    const relationshipByEntity = new Map<string, string[]>();
    for (const relationship of relationships) {
      const description = `${relationship.sourceEntity.canonicalName} ${humanizeEnum(
        relationship.relationType,
      )} ${relationship.targetEntity.canonicalName}${
        relationship.description ? `: ${relationship.description}` : ''
      }`;
      for (const entityId of [
        relationship.sourceEntityId,
        relationship.targetEntityId,
      ]) {
        const current = relationshipByEntity.get(entityId) ?? [];
        current.push(description);
        relationshipByEntity.set(entityId, current);
      }
    }

    const rankedWikiSources = entities
      .map((entity) => {
        const facts = entity.facts.map((fact) => fact.content);
        const states = entity.states.map(
          (state) =>
            `${state.attributeKey}: ${state.toValue ?? state.fromValue ?? 'sin valor'}`,
        );
        const relationshipsForEntity =
          relationshipByEntity.get(entity.id) ?? [];
        const searchable = [
          entity.canonicalName,
          entity.aliases.join(' '),
          entityTypeLabel(entity.type),
          entity.description ?? '',
          JSON.stringify(entity.attributes),
          facts.join(' '),
          states.join(' '),
          relationshipsForEntity.join(' '),
        ].join(' ');
        return {
          score:
            scoreText(searchable, terms, question) +
            scoreFuzzyNames([entity.canonicalName, ...entity.aliases], terms),
          source: {
            id: `wiki:${entity.id}`,
            kind: 'wiki' as const,
            label: `${entityTypeLabel(entity.type)} · ${entity.canonicalName}`,
            excerpt: compactText(
              [
                entity.description,
                entity.aliases.length
                  ? `Alias: ${entity.aliases.join(', ')}`
                  : null,
                Object.keys(entity.attributes as object).length
                  ? `Ficha: ${JSON.stringify(entity.attributes)}`
                  : null,
                facts.length ? `Hechos: ${facts.join(' | ')}` : null,
                states.length ? `Estados: ${states.join(' | ')}` : null,
                relationshipsForEntity.length
                  ? `Relaciones: ${relationshipsForEntity.join(' | ')}`
                  : null,
                entity.imageUrl
                  ? 'La entidad tiene una imagen asociada.'
                  : null,
              ]
                .filter(Boolean)
                .join('\n'),
              1_200,
            ),
            entityId: entity.id,
            imageUrl: entity.imageUrl,
          } satisfies ChatSource,
        };
      })
      .sort((left, right) => right.score - left.score);
    const wikiSources = rankedWikiSources
      .filter(
        (entry, index) =>
          entry.score > 0 ||
          (genericWikiIntent && index < Math.min(4, rankedWikiSources.length)),
      )
      .slice(0, MAX_WIKI_SOURCES)
      .map((entry) => entry.source);

    const timelineSourceEntries = timelineEvents
      .map((event, index) => {
        const searchable = [
          event.title,
          event.description ?? '',
          event.date ?? '',
          event.temporalLabel ?? '',
          ...event.entities.map((entry) => entry.entity.canonicalName),
        ].join(' ');
        return {
          event,
          index,
          score: scoreText(searchable, terms, question),
        };
      })
      .filter((entry) => entry.score > 0 || broadTimelineIntent)
      .sort((left, right) => left.index - right.index)
      .slice(0, MAX_TIMELINE_SOURCES);

    const timelineSourceSceneIds = [
      ...new Set(
        timelineSourceEntries
          .map((entry) => entry.event.sourceSceneId)
          .filter((sceneId): sceneId is string => Boolean(sceneId)),
      ),
    ];
    const timelineSourceChunks =
      timelineSourceSceneIds.length > 0
        ? await this.prisma.chunk.findMany({
            where: { sceneId: { in: timelineSourceSceneIds } },
            select: { sceneId: true, content: true },
            orderBy: { chunkIndex: 'asc' },
          })
        : [];
    const timelineChunksByScene = new Map<string, Array<{ content: string }>>();
    for (const chunk of timelineSourceChunks) {
      const sceneChunks = timelineChunksByScene.get(chunk.sceneId) ?? [];
      sceneChunks.push({ content: chunk.content });
      timelineChunksByScene.set(chunk.sceneId, sceneChunks);
    }

    const timelineSources = timelineSourceEntries.map(({ event }) => {
      const textQuote = event.sourceSceneId
        ? findTimelineSourceQuote(
            timelineChunksByScene.get(event.sourceSceneId),
            event.title,
            event.description,
          )
        : undefined;
      return {
        id: `timeline:${event.id}`,
        kind: 'timeline' as const,
        label: `Linea de tiempo · ${event.title}`,
        route: `/projects/${encodeURIComponent(projectId)}/worldbuilding?tab=timeline`,
        excerpt: compactText(
          [
            event.date ?? event.temporalLabel,
            event.description,
            event.entities.length
              ? `Entidades: ${event.entities
                  .map((entry) => entry.entity.canonicalName)
                  .join(', ')}`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          900,
        ),
        ...(event.sourceSceneId ? { sceneId: event.sourceSceneId } : {}),
        ...(event.sourceScene
          ? {
              chapterId: event.sourceScene.chapter.id,
              chapterTitle: event.sourceScene.chapter.title,
            }
          : {}),
        ...(textQuote ? { textQuote } : {}),
      } satisfies ChatSource;
    });

    if (countTerm) {
      return aggregateCountSources(manuscriptSources);
    }

    return fitContext([
      ...manuscriptSources,
      ...timelineSources,
      ...wikiSources,
    ]);
  }

  private async getThreadForUser(
    userId: string,
    threadId: string,
  ): Promise<ChatThreadRecord> {
    const thread = await this.prisma.chatThread.findFirst({
      where: { id: threadId, project: { userId, deletedAt: null } },
    });
    if (!thread) {
      throw new NotFoundException('Chat thread not found');
    }
    return thread;
  }

  private async assertProjectAccess(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
  }

  private toMessageRecord(message: {
    id: string;
    threadId: string;
    role: string;
    content: string;
    sources: Prisma.JsonValue | null;
    actions: Prisma.JsonValue | null;
    inputTokens: number | null;
    outputTokens: number | null;
    createdAt: Date;
  }): ChatMessageRecord {
    return {
      ...message,
      role: message.role as ChatMessageRecord['role'],
      sources: parseSources(message.sources),
      actions: parseActions(message.actions ?? null),
    };
  }
}

function buildDeterministicEvidenceAnswer(
  question: string,
  sources: ChatSource[],
): { answer: string; sources: ChatSource[] } | null {
  const countTerm = extractCountTerm(question);
  if (countTerm) {
    const manuscriptSources = sources.filter(
      (source) =>
        source.kind === 'manuscript' && source.occurrenceCount !== undefined,
    );
    if (manuscriptSources.length > 0) {
      const total = manuscriptSources.reduce(
        (sum, source) => sum + (source.occurrenceCount ?? 0),
        0,
      );
      const byChapter = new Map<string, number>();
      for (const source of manuscriptSources) {
        const chapter = source.chapterTitle ?? source.label;
        byChapter.set(
          chapter,
          (byChapter.get(chapter) ?? 0) + (source.occurrenceCount ?? 0),
        );
      }
      const breakdown = [...byChapter.entries()]
        .map(([chapter, count]) => `${count} en ${chapter}`)
        .join(', ');
      return {
        answer: `“${countTerm}” aparece ${total} ${total === 1 ? 'vez' : 'veces'} en el manuscrito consultado${breakdown ? `: ${breakdown}` : ''}. [${manuscriptSources.map((_, index) => index + 1).join(', ')}]`,
        sources: manuscriptSources,
      };
    }
  }

  if (/\b(primera|primer)\b/i.test(question)) {
    const firstMention = sources.find(
      (source) => source.kind === 'manuscript' && source.textQuote,
    );
    if (firstMention) {
      return {
        answer: `La primera referencia encontrada está en ${firstMention.label}: “${firstMention.textQuote}” [1]`,
        sources: [firstMention],
      };
    }
  }
  return null;
}

function rankManuscriptSources<
  T extends {
    id: string;
    content: string;
    scene: {
      id: string;
      title: string | null;
      sortKey: string;
      order: number;
      chapter: {
        id: string;
        title: string;
        sortKey: string;
        book: { id: string; title: string; sortKey: string };
      };
    };
  },
>(
  chunks: T[],
  terms: string[],
  countTerm: string | null,
  question: string,
  semanticRanks: ReadonlyMap<string, number>,
): ChatSource[] {
  const wantsFirst = /\b(primera|primer)\b/i.test(question);
  const candidates = chunks
    .map((chunk) => {
      const occurrenceCount = countTerm
        ? countOccurrences(chunk.content, countTerm)
        : undefined;
      return {
        chunk,
        occurrenceCount,
        lexicalScore:
          scoreText(chunk.content, terms, question) +
          (occurrenceCount ? occurrenceCount * 2 : 0),
      };
    })
    .filter((entry) =>
      countTerm
        ? (entry.occurrenceCount ?? 0) > 0
        : entry.lexicalScore > 0 || semanticRanks.has(entry.chunk.id),
    );

  const lexicalRanks = new Map(
    [...candidates]
      .filter((entry) => entry.lexicalScore > 0)
      .sort((left, right) => right.lexicalScore - left.lexicalScore)
      .map((entry, index) => [entry.chunk.id, index]),
  );
  const ranked = candidates.map((entry) => ({
    ...entry,
    score:
      reciprocalRank(lexicalRanks.get(entry.chunk.id)) +
      reciprocalRank(semanticRanks.get(entry.chunk.id)),
  }));

  ranked.sort((left, right) => {
    if (wantsFirst || countTerm) {
      return compareChunkOrder(left.chunk, right.chunk);
    }
    return (
      right.score - left.score || compareChunkOrder(left.chunk, right.chunk)
    );
  });

  const limit = countTerm ? ranked.length : MAX_MANUSCRIPT_SOURCES;
  return ranked.slice(0, limit).map(({ chunk, occurrenceCount }) => {
    const chapter = chunk.scene.chapter;
    const focusTerm =
      countTerm ?? terms.find((term) => includesTerm(chunk.content, term));
    return {
      id: `manuscript:${chunk.id}`,
      kind: 'manuscript',
      label: `${chapter.book.title} · ${chapter.title}${
        chunk.scene.title ? ` · ${chunk.scene.title}` : ''
      }`,
      excerpt: excerptAround(chunk.content, focusTerm, countTerm ? 440 : 1_000),
      bookId: chapter.book.id,
      bookTitle: chapter.book.title,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      sceneId: chunk.scene.id,
      sceneTitle: chunk.scene.title,
      textQuote: quoteAround(chunk.content, focusTerm),
      ...(occurrenceCount === undefined ? {} : { occurrenceCount }),
    };
  });
}

function reciprocalRank(rank: number | undefined): number {
  return rank === undefined ? 0 : 1 / (60 + rank + 1);
}

function extractSearchTerms(value: string): string[] {
  const normalized = normalize(value);
  return [...new Set(normalized.match(/[a-z0-9]{3,}/g) ?? [])]
    .filter((term) => !STOP_WORDS.has(term))
    .slice(0, 20);
}

function extractCountTerm(question: string): string | null {
  const normalizedQuestion = normalize(question);
  if (!/\b(cuantas|cuantos|cantidad|numero|veces)\b/.test(normalizedQuestion)) {
    return null;
  }
  const quoted = normalizedQuestion.match(/["“”']([^"“”']{3,50})["“”']/)?.[1];
  if (quoted) {
    return quoted.trim();
  }
  const match = normalizedQuestion.match(
    /(?:veces\s+)?(?:aparece|aparecen|menciona|mencionan|repite|repiten)\s+(?:el|la|los|las|un|una)?\s*([a-z0-9]{3,})/,
  );
  return match?.[1] ?? null;
}

function scoreText(text: string, terms: string[], question: string): number {
  const normalizedText = normalize(text);
  let score = 0;
  for (const term of terms) {
    const occurrences = countOccurrences(normalizedText, term);
    if (occurrences > 0) {
      score += 3 + Math.min(occurrences, 8);
    }
  }
  const normalizedQuestion = normalize(question).trim();
  if (
    normalizedQuestion.length >= 5 &&
    normalizedText.includes(normalizedQuestion)
  ) {
    score += 12;
  }
  return score;
}

function countOccurrences(text: string, term: string): number {
  const normalizedText = normalize(text).replace(/\s+/g, ' ');
  const normalizedTerm = normalize(term).replace(/\s+/g, ' ').trim();
  if (!normalizedTerm) {
    return 0;
  }
  const escapedTerm = normalizedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (
    normalizedText.match(
      new RegExp(`(^|[^a-z0-9])${escapedTerm}(?=$|[^a-z0-9])`, 'g'),
    )?.length ?? 0
  );
}

function aggregateCountSources(sources: ChatSource[]): ChatSource[] {
  const byChapter = new Map<string, ChatSource>();
  for (const source of sources) {
    const key = source.chapterId ?? source.label;
    const current = byChapter.get(key);
    if (!current) {
      byChapter.set(key, {
        ...source,
        id: `manuscript-count:${key}`,
      });
      continue;
    }
    current.occurrenceCount =
      (current.occurrenceCount ?? 0) + (source.occurrenceCount ?? 0);
  }
  return [...byChapter.values()].map((source) => ({
    ...source,
    excerpt: `${source.occurrenceCount ?? 0} coincidencias exactas en ${source.chapterTitle ?? source.label}. Ejemplo: ${source.excerpt}`,
  }));
}

function scoreFuzzyNames(names: string[], terms: string[]): number {
  let bestScore = 0;
  for (const name of names) {
    const nameTokens = normalize(name).match(/[a-z0-9]{3,}/g) ?? [];
    for (const nameToken of nameTokens) {
      for (const term of terms) {
        const similarity = trigramSimilarity(nameToken, term);
        if (similarity >= 0.55) {
          bestScore = Math.max(bestScore, 2 + similarity * 5);
        }
      }
    }
  }
  return bestScore;
}

function trigramSimilarity(left: string, right: string): number {
  if (left === right) {
    return 1;
  }
  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  if (leftTrigrams.size === 0 || rightTrigrams.size === 0) {
    return 0;
  }
  let shared = 0;
  for (const trigram of leftTrigrams) {
    if (rightTrigrams.has(trigram)) {
      shared += 1;
    }
  }
  return (2 * shared) / (leftTrigrams.size + rightTrigrams.size);
}

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const result = new Set<string>();
  for (let index = 0; index <= padded.length - 3; index += 1) {
    result.add(padded.slice(index, index + 3));
  }
  return result;
}

function includesTerm(text: string, term: string): boolean {
  return normalize(text).includes(normalize(term));
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function excerptAround(text: string, term?: string, maxLength = 900): string {
  const compact = compactText(text, Number.MAX_SAFE_INTEGER);
  if (compact.length <= maxLength) {
    return compact;
  }
  const index = term ? normalize(compact).indexOf(normalize(term)) : -1;
  const start = Math.max(
    0,
    (index < 0 ? 0 : index) - Math.floor(maxLength / 3),
  );
  const slice = compact.slice(start, start + maxLength).trim();
  return `${start > 0 ? '…' : ''}${slice}${
    start + maxLength < compact.length ? '…' : ''
  }`;
}

function findTimelineSourceQuote(
  chunks: ReadonlyArray<{ content: string }> | undefined,
  title: string,
  description: string | null,
): string | undefined {
  if (!chunks || chunks.length === 0) {
    return undefined;
  }

  const terms = extractSearchTerms(`${title} ${description ?? ''}`);
  let bestChunk: { content: string } | undefined;
  let bestScore = 0;

  for (const chunk of chunks) {
    const score = scoreText(chunk.content, terms, title);
    if (score > bestScore) {
      bestChunk = chunk;
      bestScore = score;
    }
  }

  if (!bestChunk) {
    return undefined;
  }
  const focusTerm = terms.find((term) => includesTerm(bestChunk.content, term));
  return focusTerm ? quoteAround(bestChunk.content, focusTerm) : undefined;
}

function quoteAround(text: string, term?: string, maxLength = 220): string {
  const compact = compactText(text, Number.MAX_SAFE_INTEGER);
  const termIndex = term ? normalize(compact).indexOf(normalize(term)) : -1;
  if (termIndex < 0) {
    return compact.slice(0, maxLength).trim();
  }
  const sentenceStart = Math.max(
    compact.lastIndexOf('.', termIndex - 1),
    compact.lastIndexOf('!', termIndex - 1),
    compact.lastIndexOf('?', termIndex - 1),
  );
  const possibleEnds = [
    compact.indexOf('.', termIndex),
    compact.indexOf('!', termIndex),
    compact.indexOf('?', termIndex),
  ].filter((index) => index >= 0);
  const sentenceEnd =
    possibleEnds.length > 0 ? Math.min(...possibleEnds) + 1 : compact.length;
  const sentence = compact.slice(sentenceStart + 1, sentenceEnd).trim();
  if (sentence.length <= maxLength) {
    return sentence;
  }
  const localTermIndex = normalize(sentence).indexOf(normalize(term ?? ''));
  const start = Math.max(0, localTermIndex - Math.floor(maxLength / 3));
  return sentence.slice(start, start + maxLength).trim();
}

function compactText(value: string, maxLength: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxLength
    ? `${compact.slice(0, maxLength).trim()}…`
    : compact;
}

function compareChunkOrder<
  T extends {
    scene: {
      sortKey: string;
      order: number;
      chapter: { sortKey: string; book: { sortKey: string } };
    };
  },
>(left: T, right: T): number {
  return (
    left.scene.chapter.book.sortKey.localeCompare(
      right.scene.chapter.book.sortKey,
      undefined,
      { numeric: true },
    ) ||
    left.scene.chapter.sortKey.localeCompare(
      right.scene.chapter.sortKey,
      undefined,
      { numeric: true },
    ) ||
    left.scene.order - right.scene.order ||
    left.scene.sortKey.localeCompare(right.scene.sortKey, undefined, {
      numeric: true,
    })
  );
}

function humanizeEnum(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function entityTypeLabel(value: string): string {
  const labels: Record<string, string> = {
    CHARACTER: 'Personaje',
    LOCATION: 'Lugar',
    OBJECT: 'Objeto',
    ORGANIZATION: 'Faccion',
    EVENT: 'Evento',
    CONCEPT: 'Concepto',
  };
  return labels[value] ?? humanizeEnum(value);
}

function fitContext(sources: ChatSource[]): ChatSource[] {
  let length = 0;
  const result: ChatSource[] = [];
  for (const source of sources) {
    const sourceLength = source.label.length + source.excerpt.length;
    if (length + sourceLength > MAX_CONTEXT_CHARS) {
      break;
    }
    result.push(source);
    length += sourceLength;
  }
  return result;
}

function parseSources(value: Prisma.JsonValue | null): ChatSource[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sources: ChatSource[] = [];
  for (const source of value) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      continue;
    }
    const id = Reflect.get(source, 'id');
    const kind = Reflect.get(source, 'kind');
    const label = Reflect.get(source, 'label');
    const excerpt = Reflect.get(source, 'excerpt');
    if (
      typeof id !== 'string' ||
      typeof kind !== 'string' ||
      !CHAT_SOURCE_KINDS.has(kind) ||
      typeof label !== 'string' ||
      typeof excerpt !== 'string'
    ) {
      continue;
    }
    const optionalString = (key: string): string | undefined => {
      const field = Reflect.get(source, key);
      return typeof field === 'string' ? field : undefined;
    };
    const bookId = optionalString('bookId');
    const bookTitle = optionalString('bookTitle');
    const chapterId = optionalString('chapterId');
    const chapterTitle = optionalString('chapterTitle');
    const sceneId = optionalString('sceneId');
    const entityId = optionalString('entityId');
    const textQuote = optionalString('textQuote');
    const route = optionalString('route');
    const sceneTitle = Reflect.get(source, 'sceneTitle');
    const imageUrl = Reflect.get(source, 'imageUrl');
    const occurrenceCount = Reflect.get(source, 'occurrenceCount');
    sources.push({
      id,
      kind: kind as ChatSource['kind'],
      label,
      excerpt,
      ...(bookId ? { bookId } : {}),
      ...(bookTitle ? { bookTitle } : {}),
      ...(chapterId ? { chapterId } : {}),
      ...(chapterTitle ? { chapterTitle } : {}),
      ...(sceneId ? { sceneId } : {}),
      ...(typeof sceneTitle === 'string' || sceneTitle === null
        ? { sceneTitle }
        : {}),
      ...(entityId ? { entityId } : {}),
      ...(typeof imageUrl === 'string' || imageUrl === null
        ? { imageUrl }
        : {}),
      ...(typeof occurrenceCount === 'number' &&
      Number.isFinite(occurrenceCount)
        ? { occurrenceCount }
        : {}),
      ...(textQuote ? { textQuote } : {}),
      ...(route ? { route } : {}),
    });
  }
  return sources;
}

function parseActions(value: unknown): ChatAction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isChatAction);
}

function isChatAction(value: unknown): value is ChatAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, Prisma.JsonValue>;
  return (
    candidate['kind'] === 'navigation' &&
    typeof candidate['id'] === 'string' &&
    typeof candidate['label'] === 'string' &&
    typeof candidate['description'] === 'string' &&
    typeof candidate['route'] === 'string'
  );
}

const CHAT_SOURCE_KINDS = new Set<string>(['manuscript', 'wiki', 'timeline']);
