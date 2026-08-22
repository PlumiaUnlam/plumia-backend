import { BadRequestException } from '@nestjs/common';
import { SpeechController } from '../../../src/speech/speech.controller';

describe('SpeechController', () => {
  it('delegates an audio upload to the speech provider', async () => {
    const speechToText = {
      transcribe: jest.fn().mockResolvedValue({
        text: 'Una idea para la escena',
        language: 'es',
      }),
    };
    const controller = new SpeechController(speechToText);
    const file = {
      buffer: Buffer.from('audio'),
      mimetype: 'audio/webm',
      originalname: 'voice-note.webm',
      size: 5,
    };

    await expect(controller.transcribe(file)).resolves.toEqual({
      text: 'Una idea para la escena',
      language: 'es',
    });
    expect(speechToText.transcribe).toHaveBeenCalledWith({
      audio: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname,
    });
  });

  it('rejects a request without an audio file', async () => {
    const speechToText = { transcribe: jest.fn() };
    const controller = new SpeechController(speechToText);

    await expect(controller.transcribe(undefined)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(speechToText.transcribe).not.toHaveBeenCalled();
  });

  it('rejects non-audio uploads', async () => {
    const speechToText = { transcribe: jest.fn() };
    const controller = new SpeechController(speechToText);

    await expect(
      controller.transcribe({
        buffer: Buffer.from('text'),
        mimetype: 'text/plain',
        originalname: 'note.txt',
        size: 4,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
