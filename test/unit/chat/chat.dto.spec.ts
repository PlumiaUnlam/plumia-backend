import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateChatThreadDto } from '../../../src/chat/dto/create-chat-thread.dto';
import { SendChatMessageDto } from '../../../src/chat/dto/send-chat-message.dto';
import { UpdateChatThreadDto } from '../../../src/chat/dto/update-chat-thread.dto';

describe('Chat DTOs', () => {
  const uuid = '52b6597b-72fd-4cd4-b41c-35ed55bd157a';

  it('accepts valid optional thread fields', async () => {
    const dto = plainToInstance(CreateChatThreadDto, {
      title: 'Investigación',
      currentChapterId: uuid,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ content: '' }, 'content'],
    [{ content: '   ' }, 'content'],
    [{ content: 'x'.repeat(4_001) }, 'content'],
    [{ content: 'Pregunta', currentChapterId: 'invalid' }, 'currentChapterId'],
  ])('rejects invalid message input %o', async (value, field) => {
    const errors = await validate(plainToInstance(SendChatMessageDto, value));

    expect(errors.map((error) => error.property)).toContain(field);
  });

  it('accepts the maximum message size and a valid chapter UUID', async () => {
    const dto = plainToInstance(SendChatMessageDto, {
      content: 'x'.repeat(4_000),
      currentChapterId: uuid,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it.each([
    [{ title: '   ' }, 'title'],
    [{ title: 'x'.repeat(201) }, 'title'],
    [{ isArchived: 'true' }, 'isArchived'],
    [{ antiSpoilerEnabled: 1 }, 'antiSpoilerEnabled'],
  ])('rejects invalid thread update %o', async (value, field) => {
    const errors = await validate(plainToInstance(UpdateChatThreadDto, value));

    expect(errors.map((error) => error.property)).toContain(field);
  });
});
