import type {
  AiCredentialSource,
  AiProvider,
  AiProviderCredentialStatus,
} from '../ai-provider-settings.types';

export class AiSettingsResponseDto {
  configured!: boolean;
  keyPrefix!: string | null;
  updatedAt!: Date | null;
  autoAnalyzeOnAutosave!: boolean;
  entityExtractionThresholds!: Record<string, number>;
  provider!: AiProvider;
  model!: string;
  credentialSource!: AiCredentialSource;
  providers!: AiProviderCredentialStatus[];
}
