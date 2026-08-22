import {
  BadRequestException,
  Controller,
  Inject,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  SPEECH_TO_TEXT_PROVIDER,
  type SpeechToTextProvider,
} from './ports/speech-to-text-provider.port';

const MAX_AUDIO_BYTES = 10 * 1024 * 1024;

@Controller('speech-to-text')
export class SpeechController {
  constructor(
    @Inject(SPEECH_TO_TEXT_PROVIDER)
    private readonly speechToText: SpeechToTextProvider,
  ) {}

  @Post('transcribe')
  @UseGuards(ThrottlerGuard)
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: MAX_AUDIO_BYTES } }),
  )
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  async transcribe(
    @UploadedFile() file: UploadedAudioFile | undefined,
  ): Promise<{ text: string; language?: string }> {
    if (!file) {
      throw new BadRequestException('Debes enviar un archivo de audio.');
    }
    if (!file.mimetype.startsWith('audio/')) {
      throw new BadRequestException('El archivo debe ser un audio válido.');
    }
    if (file.size > MAX_AUDIO_BYTES) {
      throw new BadRequestException('El audio no puede superar los 10 MB.');
    }

    return this.speechToText.transcribe({
      audio: file.buffer,
      mimeType: file.mimetype,
      filename: file.originalname || 'voice-note.webm',
    });
  }
}

interface UploadedAudioFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}
