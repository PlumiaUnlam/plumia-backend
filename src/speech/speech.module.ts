import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LocalWhisperSpeechToTextAdapter } from './adapters/local-whisper-speech-to-text.adapter';
import { SpeechController } from './speech.controller';
import {
  SPEECH_TO_TEXT_PROVIDER,
  type SpeechToTextProvider,
} from './ports/speech-to-text-provider.port';

@Module({
  controllers: [SpeechController],
  providers: [
    LocalWhisperSpeechToTextAdapter,
    {
      provide: SPEECH_TO_TEXT_PROVIDER,
      inject: [ConfigService, LocalWhisperSpeechToTextAdapter],
      useFactory: (
        config: ConfigService,
        localWhisper: LocalWhisperSpeechToTextAdapter,
      ): SpeechToTextProvider => {
        const provider = config.get<string>('STT_PROVIDER', 'local');
        if (provider !== 'local') {
          throw new Error(
            `STT_PROVIDER=${provider} todavía no está implementado.`,
          );
        }
        return localWhisper;
      },
    },
  ],
})
export class SpeechModule {}
