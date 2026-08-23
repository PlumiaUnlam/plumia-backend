import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChatThreadDto } from '../../../src/chat/dto/create-chat-thread.dto';
import { SendChatMessageDto } from '../../../src/chat/dto/send-chat-message.dto';
import { UpdateChatThreadDto } from '../../../src/chat/dto/update-chat-thread.dto';

describe('Chat DTOs', () => {
  it('accepts valid optional thread fields', async () => {
    const dto = plainToInstance(CreateChatThreadDto, {
      title: 'Investigación',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ content: '' }, 'content'],
    [{ content: '   ' }, 'content'],
    [{ content: 'x'.repeat(4_001) }, 'content'],
  ])('rejects invalid message input %o', async (value, field) => {
    const errors = await validate(plainToInstance(SendChatMessageDto, value));

    expect(errors.map((error) => error.property)).toContain(field);
  });

  it('accepts the maximum message size without editor context', async () => {
    const dto = plainToInstance(SendChatMessageDto, {
      content: 'x'.repeat(4_000),
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ isArchived: 'true' }, 'isArchived'],
  ])('rejects invalid thread update %o', async (value, field) => {
    const errors = await validate(plainToInstance(UpdateChatThreadDto, value));

    expect(errors.map((error) => error.property)).toContain(field);
  });
});
