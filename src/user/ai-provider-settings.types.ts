export const AI_PROVIDERS = ['gemini', 'anthropic'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

export const AI_CREDENTIAL_SOURCES = ['USER', 'SERVER'] as const;
export type AiCredentialSource = (typeof AI_CREDENTIAL_SOURCES)[number];

export const AI_PROVIDER_CATALOG: Record<
  AiProvider,
  { label: string; models: Array<{ id: string; label: string }> }
> = {
  gemini: {
    label: 'Google Gemini',
    models: [
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite' },
    ],
  },
  anthropic: {
    label: 'Anthropic Claude',
    models: [
      { id: 'claude-opus-5', label: 'Claude Opus 5' },
      { id: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Claude Haiku 4.5',
      },
    ],
  },
};

export interface AiProviderCredentialStatus {
  provider: AiProvider;
  label: string;
  suggestedModels: Array<{ id: string; label: string }>;
  customModelsAllowed: true;
  serverCredentialAvailable: boolean;
  userKeyConfigured: boolean;
  keyPrefix: string | null;
  updatedAt: Date | null;
}
