import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import {
  AI_CREDENTIAL_SOURCES,
  AI_PROVIDERS,
  type AiCredentialSource,
  type AiProvider,
} from '../ai-provider-settings.types';

export class UpdateAiProviderSettingsDto {
  @IsIn(AI_PROVIDERS)
  provider!: AiProvider;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  model!: string;

  @IsIn(AI_CREDENTIAL_SOURCES)
  credentialSource!: AiCredentialSource;
}
