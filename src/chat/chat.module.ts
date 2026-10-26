import { Module } from '@nestjs/common';
import { GeminiChatGenerationAdapter } from './adapters/gemini-chat-generation.adapter';
import { GeminiEmbeddingAdapter } from './adapters/gemini-embedding.adapter';
import { GeminiApplicationHelpEmbeddingAdapter } from './adapters/gemini-application-help-embedding.adapter';
import { PgApplicationHelpStore } from './adapters/pg-application-help-store.adapter';
import { PgVectorStore } from './adapters/pg-vector-store.adapter';
import { PrismaStaleChunkStore } from './adapters/prisma-stale-chunk-store.adapter';
import { ApplicationHelpIndexService } from './application-help-index.service';
import { ChatEmbeddingIndexService } from './chat-embedding-index.service';
import { ChatController } from './chat.controller';
import { ChatRoutingService } from './chat-routing.service';
import { ChatConflictService } from './chat-conflict.service';
import { ChatService } from './chat.service';
import { CHAT_GENERATION_PROVIDER } from './ports/chat-generation-provider.port';
import { CHAT_INTENT_PROVIDER } from './ports/chat-intent-provider.port';
import { CHAT_EVIDENCE_VERIFIER } from './ports/chat-evidence-verifier.port';
import { EMBEDDING_PROVIDER } from './ports/embedding-provider.port';
import { APPLICATION_HELP_EMBEDDING_PROVIDER } from './ports/application-help-embedding-provider.port';
import { APPLICATION_HELP_STORE } from './ports/application-help-store.port';
import { STALE_CHUNK_STORE } from './ports/stale-chunk-store.port';
import { VECTOR_STORE } from './ports/vector-store.port';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatRoutingService,
    ChatConflictService,
    ChatEmbeddingIndexService,
    ApplicationHelpIndexService,
    GeminiChatGenerationAdapter,
    {
      provide: CHAT_GENERATION_PROVIDER,
      useExisting: GeminiChatGenerationAdapter,
    },
    { provide: CHAT_INTENT_PROVIDER, useExisting: GeminiChatGenerationAdapter },
    {
      provide: CHAT_EVIDENCE_VERIFIER,
      useExisting: GeminiChatGenerationAdapter,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useClass: GeminiEmbeddingAdapter,
    },
    {
      provide: APPLICATION_HELP_EMBEDDING_PROVIDER,
      useClass: GeminiApplicationHelpEmbeddingAdapter,
    },
    {
      provide: STALE_CHUNK_STORE,
      useClass: PrismaStaleChunkStore,
    },
    { provide: VECTOR_STORE, useClass: PgVectorStore },
    { provide: APPLICATION_HELP_STORE, useClass: PgApplicationHelpStore },
  ],
  exports: [ChatService],
})
export class ChatModule {}
