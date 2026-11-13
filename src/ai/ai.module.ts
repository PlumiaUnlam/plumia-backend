import { Global, Module } from '@nestjs/common';
import { EmbeddingRouter } from './embedding-router.service';
import { LlmRouter } from './llm-router.service';

/** Central AI access: fallback chains, circuit breakers and provider clients. */
@Global()
@Module({
  providers: [LlmRouter, EmbeddingRouter],
  exports: [LlmRouter, EmbeddingRouter],
})
export class AiModule {}
