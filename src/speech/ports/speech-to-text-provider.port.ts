export const SPEECH_TO_TEXT_PROVIDER = Symbol('SPEECH_TO_TEXT_PROVIDER');

export interface SpeechToTextInput {
  audio: Buffer;
  mimeType: string;
  filename: string;
  language?: string;
}

export interface SpeechToTextResult {
  text: string;
  language?: string;
}

export interface SpeechToTextProvider {
  transcribe(input: SpeechToTextInput): Promise<SpeechToTextResult>;
}
