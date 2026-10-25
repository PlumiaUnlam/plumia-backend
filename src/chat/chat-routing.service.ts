import { Inject, Injectable } from '@nestjs/common';
import { ApplicationHelpIndexService } from './application-help-index.service';
import { isApplicationHelpIntent } from './domain/application-guide';
import {
  CHAT_CLARIFICATION_RESPONSE,
  CHAT_CREATIVE_REFUSAL,
  CHAT_OUT_OF_SCOPE_RESPONSE,
  CHAT_UNSAFE_RESPONSE,
  getSafetyRefusal,
  getSocialResponse,
  isCreativeRequest,
} from './domain/chat-policy';
import {
  CHAT_INTENT_PROVIDER,
  type ChatIntentProvider,
} from './ports/chat-intent-provider.port';
import type { ChatHistoryEntry } from './ports/chat-generation-provider.port';

export type ChatRoute =
  | {
      kind: 'immediate';
      answer: string;
      inputTokens: number;
      outputTokens: number;
    }
  | {
      kind: 'work' | 'application_help';
      inputTokens: number;
      outputTokens: number;
    };

@Injectable()
export class ChatRoutingService {
  constructor(
    @Inject(CHAT_INTENT_PROVIDER)
    private readonly intentProvider: ChatIntentProvider,
    private readonly applicationHelpIndex: ApplicationHelpIndexService,
  ) {}

  async route(
    question: string,
    history: ChatHistoryEntry[],
    signal?: AbortSignal,
  ): Promise<ChatRoute> {
    const safetyRefusal = getSafetyRefusal(question);
    if (safetyRefusal) {
      return immediate(safetyRefusal);
    }

    const socialResponse = getSocialResponse(question);
    if (socialResponse) {
      return immediate(socialResponse);
    }
    if (isCreativeRequest(question)) {
      return immediate(CHAT_CREATIVE_REFUSAL);
    }

    const helpHint =
      isApplicationHelpIntent(question, { history }) ||
      (await this.applicationHelpIndex.matchesApplicationHelpIntent(question));
    const decision = await this.intentProvider.classify({
      question,
      history,
      helpHint,
      ...(signal ? { signal } : {}),
    });
    const usage = {
      inputTokens: decision.inputTokens,
      outputTokens: decision.outputTokens,
    };
    switch (decision.intent) {
      case 'work':
      case 'application_help':
        return { kind: decision.intent, ...usage };
      case 'out_of_scope':
        return {
          kind: 'immediate',
          answer: CHAT_OUT_OF_SCOPE_RESPONSE,
          ...usage,
        };
      case 'unsafe':
        return { kind: 'immediate', answer: CHAT_UNSAFE_RESPONSE, ...usage };
      case 'creative':
        return { kind: 'immediate', answer: CHAT_CREATIVE_REFUSAL, ...usage };
      case 'clarify':
        return {
          kind: 'immediate',
          answer: CHAT_CLARIFICATION_RESPONSE,
          ...usage,
        };
    }
  }
}

function immediate(answer: string): ChatRoute {
  return { kind: 'immediate', answer, inputTokens: 0, outputTokens: 0 };
}
