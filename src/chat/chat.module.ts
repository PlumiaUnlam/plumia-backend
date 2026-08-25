import { Module } from '@nestjs/common';
import { GeminiChatGenerationAdapter } from './adapters/gemini-chat-generation.adapter';
import { GeminiEmbeddingAdapter } from './adapters/gemini-embedding.adapter';
import { PgVectorStore } from './adapters/pg-vector-store.adapter';
import { PrismaStaleChunkStore } from './adapters/prisma-stale-chunk-store.adapter';
import { ChatEmbeddingIndexService } from './chat-embedding-index.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { CHAT_GENERATION_PROVIDER } from './ports/chat-generation-provider.port';
import { EMBEDDING_PROVIDER } from './ports/embedding-provider.port';
import { STALE_CHUNK_STORE } from './ports/stale-chunk-store.port';
import { VECTOR_STORE } from './ports/vector-store.port';

@Module({
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatEmbeddingIndexService,
    {
      provide: CHAT_GENERATION_PROVIDER,
      useClass: GeminiChatGenerationAdapter,
    },
    {
      provide: EMBEDDING_PROVIDER,
      useClass: GeminiEmbeddingAdapter,
    },
    {
      provide: STALE_CHUNK_STORE,
      useClass: PrismaStaleChunkStore,
    },
    { provide: VECTOR_STORE, useClass: PgVectorStore },
  ],
  exports: [ChatService],
})
export class ChatModule {}
