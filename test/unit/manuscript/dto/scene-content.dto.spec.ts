import { validate } from 'class-validator';
import { CreateSceneDto } from '../../../../src/manuscript/dto/scenes/create-scene.dto';
import { UpdateSceneContentDto } from '../../../../src/manuscript/dto/scenes/update-scene-content.dto';

describe('Scene content DTOs', () => {
  it('accepts TipTap documents', async () => {
    const dto = new UpdateSceneContentDto();
    dto.content = {
      type: 'doc',
      content: [{ type: 'paragraph' }],
    };

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects arbitrary content objects', async () => {
    const dto = new UpdateSceneContentDto();
    dto.content = { unexpected: true };

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.constraints).toHaveProperty('tiptapDocument');
  });

  it('validates optional scene content on create when present', async () => {
    const dto = new CreateSceneDto();
    dto.sortKey = '001';
    dto.content = { type: 'not-doc' };

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain('content');
  });
});
