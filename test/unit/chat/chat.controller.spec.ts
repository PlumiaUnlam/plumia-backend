import { ChatController } from '../../../src/chat/chat.controller';
import type { ChatService } from '../../../src/chat/chat.service';

describe('ChatController', () => {
  it('rate-limits model-backed messages per authenticated user', () => {
    const handler = ChatController.prototype.sendMessage;
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as
      | number
      | undefined;
    const ttl = Reflect.getMetadata('THROTTLER:TTLdefault', handler) as
      | number
      | undefined;
    const tracker = Reflect.getMetadata(
      'THROTTLER:TRACKERdefault',
      handler,
    ) as (request: Record<string, unknown>) => string;

    expect(limit).toBe(12);
    expect(ttl).toBe(60_000);
    expect(tracker({ user: { id: 'user-1' }, ip: '127.0.0.1' })).toBe(
      'user:user-1',
    );
    expect(tracker({ ip: '127.0.0.1' })).toBe('ip:127.0.0.1');
  });

  it('delegates a message with the authenticated identity and DTO', async () => {
    const exchange = { userMessage: {}, assistantMessage: {} };
    const chatService = {
      sendMessage: jest.fn().mockResolvedValue(exchange),
    };
    const controller = new ChatController(
      chatService as unknown as ChatService,
    );
    const dto = { content: '¿Dónde aparece Maren?' };
    const request = {
      user: { id: 'user-1' },
      once: jest.fn(),
      removeListener: jest.fn(),
    };
    const response = {
      once: jest.fn(),
      removeListener: jest.fn(),
    };

    await expect(
      controller.sendMessage(
        request as never,
        'thread-1',
        dto,
        response as never,
      ),
    ).resolves.toBe(exchange);
    expect(chatService.sendMessage).toHaveBeenCalledTimes(1);
    expect(request.once).toHaveBeenCalledWith('aborted', expect.any(Function));
    expect(response.once).toHaveBeenCalledWith('close', expect.any(Function));
  });
});
