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
    expect(tracker({ user: { id: 42 } })).toBe('anonymous');
  });

  it('routes thread creation, pagination, message listing, updates, and deletion', async () => {
    const thread = { id: 'thread-1' };
    const chatService = {
      createThread: jest.fn().mockResolvedValue(thread),
      listThreads: jest.fn().mockResolvedValue({ items: [thread], total: 1 }),
      listMessages: jest.fn().mockResolvedValue([{ id: 'message-1' }]),
      updateThread: jest.fn().mockResolvedValue(thread),
      deleteThread: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new ChatController(
      chatService as unknown as ChatService,
    );
    const request = { user: { id: 'user-1' } };
    const createDto = { title: 'Research' };
    const updateDto = { title: 'Revised research' };

    await expect(
      controller.createThread(
        request as never,
        'project-1',
        createDto as never,
      ),
    ).resolves.toBe(thread);
    await expect(
      controller.listThreads(request as never, 'project-1', {
        page: '0',
        pageSize: '100',
        search: 'Mara',
      }),
    ).resolves.toEqual({ items: [thread], total: 1 });
    await expect(
      controller.listThreads(request as never, 'project-1', {
        page: '2.5',
        pageSize: 'not-a-number',
      }),
    ).resolves.toEqual({ items: [thread], total: 1 });
    await expect(
      controller.listMessages(request as never, 'thread-1'),
    ).resolves.toEqual([{ id: 'message-1' }]);
    await expect(
      controller.updateThread(request as never, 'thread-1', updateDto as never),
    ).resolves.toBe(thread);
    await expect(
      controller.deleteThread(request as never, 'thread-1'),
    ).resolves.toBeUndefined();

    expect(chatService.createThread).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      createDto,
    );
    expect(chatService.listThreads).toHaveBeenNthCalledWith(
      1,
      'user-1',
      'project-1',
      { page: 1, pageSize: 50, search: 'Mara' },
    );
    expect(chatService.listThreads).toHaveBeenNthCalledWith(
      2,
      'user-1',
      'project-1',
      { page: 1, pageSize: 20 },
    );
    expect(chatService.listMessages).toHaveBeenCalledWith('user-1', 'thread-1');
    expect(chatService.updateThread).toHaveBeenCalledWith(
      'user-1',
      'thread-1',
      updateDto,
    );
    expect(chatService.deleteThread).toHaveBeenCalledWith('user-1', 'thread-1');
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

  it('aborts provider work when the request disconnects and cleans up listeners on rejection', async () => {
    const listeners = new Map<string, () => void>();
    const chatService = {
      sendMessage: jest.fn().mockRejectedValue(new Error('upstream failed')),
    };
    const controller = new ChatController(
      chatService as unknown as ChatService,
    );
    const request = {
      user: { id: 'user-1' },
      once: jest.fn((event: string, listener: () => void) => {
        listeners.set(`request:${event}`, listener);
      }),
      removeListener: jest.fn(),
    };
    const response = {
      once: jest.fn((event: string, listener: () => void) => {
        listeners.set(`response:${event}`, listener);
      }),
      removeListener: jest.fn(),
    };

    const result = controller.sendMessage(
      request as never,
      'thread-1',
      { content: 'Question' },
      response as never,
    );
    listeners.get('request:aborted')?.();
    const sendCalls = chatService.sendMessage.mock.calls as Array<
      [string, string, { content: string }, { signal: AbortSignal }]
    >;
    const options = sendCalls[0]?.[3];
    if (!options) {
      throw new Error('Expected the controller to pass an abort signal');
    }

    expect(options.signal.aborted).toBe(true);
    await expect(result).rejects.toThrow('upstream failed');
    expect(request.removeListener).toHaveBeenCalledWith(
      'aborted',
      listeners.get('request:aborted'),
    );
    expect(response.removeListener).toHaveBeenCalledWith(
      'close',
      listeners.get('response:close'),
    );
  });
});
