import { Module } from '@nestjs/common';
import { PgVectorStore } from './adapters/pg-vector-store.adapter';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { VECTOR_STORE } from './ports/vector-store.port';

@Module({
  controllers: [ChatController],
  providers: [ChatService, { provide: VECTOR_STORE, useClass: PgVectorStore }],
  exports: [ChatService],
})
export class ChatModule {}
