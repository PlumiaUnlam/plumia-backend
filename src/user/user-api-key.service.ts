import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AiSettingsResponseDto } from './dto/ai-settings-response.dto';
import {
  normalizeEntityRecognitionThresholds,
  type EntityRecognitionThresholds,
} from '../system/entity-extraction/entity-recognition-settings';
import {
  AI_PROVIDER_CATALOG,
  AI_PROVIDERS,
  type AiCredentialSource,
  type AiProvider,
} from './ai-provider-settings.types';

const GEMINI_PROVIDER = 'gemini';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5';
const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

interface StoredApiKey {
  encryptedKey: string;
  iv: Buffer;
  tag: Buffer;
}

/** Stores user-owned provider keys without exposing them through the API. */
@Injectable()
export class UserApiKeyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getAiSettings(userId: string): Promise<AiSettingsResponseDto> {
    const recognitionSettingsModel = (
      this.prisma as PrismaService & {
        userEntityRecognitionSettings?: PrismaService['userEntityRecognitionSettings'];
      }
    ).userEntityRecognitionSettings;
    const [records, user, recognitionSettings, savedProviderSettings] =
      await Promise.all([
        this.prisma.userApiKey.findMany({
          where: {
            userId,
            provider: { in: [...AI_PROVIDERS] },
            isActive: true,
          },
          select: { provider: true, keyPrefix: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          select: { autoAnalyzeOnAutosave: true },
        }),
        recognitionSettingsModel?.findUnique({
          where: { userId },
          select: { thresholds: true },
        }) ?? Promise.resolve(null),
        this.prisma.userAiProviderSettings.findUnique({
          where: { userId },
          select: { provider: true, model: true, credentialSource: true },
        }),
      ]);

    const keyByProvider = new Map(
      records.map((record) => [record.provider, record]),
    );
    const geminiKey = keyByProvider.get('gemini');
    const serverProvider = this.getServerProvider();
    const activeProvider = savedProviderSettings
      ? this.normalizeProvider(savedProviderSettings.provider)
      : geminiKey
        ? 'gemini'
        : serverProvider;
    const provider = activeProvider ?? serverProvider;
    const credentialSource =
      (savedProviderSettings
        ? this.normalizeCredentialSource(savedProviderSettings.credentialSource)
        : null) ?? (geminiKey ? 'USER' : 'SERVER');
    const selectedModel = savedProviderSettings?.model.trim();
    const model =
      selectedModel ||
      (provider === serverProvider ? this.getServerModel(provider) : '') ||
      this.getDefaultModel(provider);
    const providers = AI_PROVIDERS.map((providerOption) => {
      const key = keyByProvider.get(providerOption);
      const catalog = AI_PROVIDER_CATALOG[providerOption];
      return {
        provider: providerOption,
        label: catalog.label,
        suggestedModels: catalog.models,
        customModelsAllowed: true as const,
        serverCredentialAvailable: Boolean(
          this.getServerApiKey(providerOption),
        ),
        userKeyConfigured: Boolean(key),
        keyPrefix: key?.keyPrefix ?? null,
        updatedAt: key?.updatedAt ?? null,
      };
    });

    return {
      configured: Boolean(geminiKey),
      keyPrefix: geminiKey?.keyPrefix ?? null,
      updatedAt: geminiKey?.updatedAt ?? null,
      autoAnalyzeOnAutosave: user?.autoAnalyzeOnAutosave ?? true,
      entityExtractionThresholds: normalizeEntityRecognitionThresholds(
        recognitionSettings?.thresholds,
      ),
      provider,
      model,
      credentialSource,
      providers,
    };
  }

  /** Kept for the existing Gemini settings endpoint. */
  getGeminiSettings(userId: string): Promise<AiSettingsResponseDto> {
    return this.getAiSettings(userId);
  }

  async updateAiProviderSettings(
    userId: string,
    settings: {
      provider: AiProvider;
      model: string;
      credentialSource: AiCredentialSource;
    },
  ): Promise<AiSettingsResponseDto> {
    const provider = this.normalizeProvider(settings.provider);
    const credentialSource = this.normalizeCredentialSource(
      settings.credentialSource,
    );
    const model = settings.model.trim();
    if (!provider || !credentialSource || !model || model.length > 120) {
      throw new BadRequestException(
        'La configuración del proveedor no es válida',
      );
    }

    if (credentialSource === 'USER') {
      const key = await this.findActiveKey(userId, provider);
      if (!key) {
        throw new BadRequestException(
          'Guardá una API Key personal para el proveedor seleccionado antes de usarla',
        );
      }
    } else if (!this.getServerApiKey(provider)) {
      throw new BadRequestException(
        'PlumIA no tiene una credencial configurada para ese proveedor',
      );
    }

    await this.prisma.userAiProviderSettings.upsert({
      where: { userId },
      create: { userId, provider, model, credentialSource },
      update: { provider, model, credentialSource },
    });

    return this.getAiSettings(userId);
  }

  async getExtractionProviderConfiguration(userId?: string): Promise<{
    provider: AiProvider;
    model: string;
    credentialSource: AiCredentialSource;
    apiKey: string;
  }> {
    const settings = userId
      ? await this.getAiSettings(userId)
      : {
          provider: this.getServerProvider(),
          model:
            this.getServerModel(this.getServerProvider()) ||
            this.getDefaultModel(this.getServerProvider()),
          credentialSource: 'SERVER' as const,
        };
    const apiKey =
      settings.credentialSource === 'USER' && userId
        ? await this.getActiveProviderKey(userId, settings.provider)
        : this.getServerApiKey(settings.provider);

    if (!apiKey) {
      throw new ServiceUnavailableException(
        settings.credentialSource === 'USER'
          ? `No hay una API Key personal activa para ${settings.provider}`
          : `PlumIA no tiene una API Key configurada para ${settings.provider}`,
      );
    }

    if (!settings.model) {
      throw new ServiceUnavailableException(
        `No hay un modelo configurado para ${settings.provider}`,
      );
    }

    return {
      provider: settings.provider,
      model: settings.model,
      credentialSource: settings.credentialSource,
      apiKey,
    };
  }

  async saveProviderKey(
    userId: string,
    providerInput: string,
    apiKey: string,
  ): Promise<AiSettingsResponseDto> {
    const provider = this.normalizeProvider(providerInput);
    const normalizedKey = apiKey.trim();
    if (!provider) {
      throw new BadRequestException('Proveedor de IA no compatible');
    }
    if (!normalizedKey) {
      throw new BadRequestException('La API Key no puede estar vacía');
    }

    const encrypted = this.encrypt(normalizedKey);
    const keyPrefix = this.toKeyPrefix(normalizedKey);
    await this.prisma.$transaction(async (tx) => {
      await tx.userApiKey.updateMany({
        where: { userId, provider, isActive: true },
        data: { isActive: false },
      });
      await tx.userApiKey.create({
        data: {
          userId,
          provider,
          encryptedKey: encrypted.encryptedKey,
          iv: encrypted.iv,
          tag: encrypted.tag,
          keyPrefix,
          isActive: true,
        },
        select: { keyPrefix: true, updatedAt: true },
      });
    });

    return this.getAiSettings(userId);
  }

  async removeProviderKey(
    userId: string,
    providerInput: string,
  ): Promise<void> {
    const provider = this.normalizeProvider(providerInput);
    if (!provider) {
      throw new BadRequestException('Proveedor de IA no compatible');
    }
    const selectedSettings =
      await this.prisma.userAiProviderSettings.findUnique({
        where: { userId },
        select: { provider: true, credentialSource: true },
      });
    if (
      selectedSettings?.provider === provider &&
      selectedSettings.credentialSource === 'USER'
    ) {
      throw new BadRequestException(
        'Cambiá la fuente de credencial antes de eliminar la clave que está en uso',
      );
    }
    await this.prisma.userApiKey.deleteMany({ where: { userId, provider } });
  }

  private async findActiveKey(userId: string, provider: AiProvider) {
    return this.prisma.userApiKey.findFirst({
      where: { userId, provider, isActive: true },
      select: {
        encryptedKey: true,
        iv: true,
        tag: true,
        keyPrefix: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  private async getActiveProviderKey(
    userId: string,
    provider: AiProvider,
  ): Promise<string | null> {
    const record = await this.findActiveKey(userId, provider);
    return record ? this.decrypt(record) : null;
  }

  private normalizeProvider(value: string): AiProvider | null {
    const normalized = value.trim().toLowerCase();
    return AI_PROVIDERS.includes(normalized as AiProvider)
      ? (normalized as AiProvider)
      : null;
  }

  private normalizeCredentialSource(value: string): AiCredentialSource | null {
    return value === 'USER' || value === 'SERVER' ? value : null;
  }

  private getServerProvider(): AiProvider {
    return (
      this.normalizeProvider(
        this.config.get<string>('ENTITY_EXTRACTION_PROVIDER', 'gemini'),
      ) ?? 'gemini'
    );
  }

  private getServerModel(provider: AiProvider): string {
    const configured = this.config
      .get<string>('ENTITY_EXTRACTION_MODEL', '')
      .trim();
    if (configured) return configured;
    return provider === 'anthropic' ? DEFAULT_ANTHROPIC_MODEL : '';
  }

  private getDefaultModel(provider: AiProvider): string {
    return provider === 'anthropic'
      ? DEFAULT_ANTHROPIC_MODEL
      : DEFAULT_GEMINI_MODEL;
  }

  private getServerApiKey(provider: AiProvider): string {
    const configKey =
      provider === 'anthropic'
        ? 'ANTHROPIC_API_KEY'
        : 'ENTITY_EXTRACTION_API_KEY';
    return this.config.get<string>(configKey, '').trim();
  }

  async updateEntityRecognitionThresholds(
    userId: string,
    thresholds: EntityRecognitionThresholds,
  ): Promise<AiSettingsResponseDto> {
    await this.prisma.userEntityRecognitionSettings.upsert({
      where: { userId },
      create: {
        userId,
        thresholds: normalizeEntityRecognitionThresholds(thresholds),
      },
      update: {
        thresholds: normalizeEntityRecognitionThresholds(thresholds),
      },
    });

    return this.getAiSettings(userId);
  }

  async updateAutoAnalyzeOnAutosave(
    userId: string,
    enabled: boolean,
  ): Promise<AiSettingsResponseDto> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { autoAnalyzeOnAutosave: enabled },
    });

    return this.getAiSettings(userId);
  }

  async saveGeminiKey(
    userId: string,
    apiKey: string,
  ): Promise<AiSettingsResponseDto> {
    return this.saveProviderKey(userId, GEMINI_PROVIDER, apiKey);
  }

  async removeGeminiKey(userId: string): Promise<void> {
    return this.removeProviderKey(userId, GEMINI_PROVIDER);
  }

  async getActiveGeminiKey(userId: string): Promise<string | null> {
    return this.getActiveProviderKey(userId, GEMINI_PROVIDER);
  }

  private encrypt(value: string): StoredApiKey {
    const key = this.getEncryptionKeyForWrite();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    return {
      encryptedKey: encrypted.toString('base64'),
      iv,
      tag: cipher.getAuthTag(),
    };
  }

  private decrypt(value: StoredApiKey): string {
    const key = this.getEncryptionKeyForRead();
    try {
      const decipher = createDecipheriv(AES_ALGORITHM, key, value.iv);
      decipher.setAuthTag(value.tag);
      const encrypted = Buffer.from(value.encryptedKey, 'base64');
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error('Stored AI provider API key could not be decrypted');
    }
  }

  private getEncryptionKeyForWrite(): Buffer {
    const key = this.getEncryptionKey();
    if (!key) {
      throw new ServiceUnavailableException(
        'La configuracion segura de claves de IA no esta disponible',
      );
    }
    return key;
  }

  private getEncryptionKeyForRead(): Buffer {
    const key = this.getEncryptionKey();
    if (!key) {
      throw new Error('AI key encryption is not configured');
    }
    return key;
  }

  private getEncryptionKey(): Buffer | null {
    const configured = this.config.get<string>('ENCRYPTION_KEY', '').trim();
    if (!/^[0-9a-fA-F]{64}$/.test(configured)) {
      return null;
    }
    const key = Buffer.from(configured, 'hex');
    return key.length === KEY_LENGTH ? key : null;
  }

  private toKeyPrefix(value: string): string {
    return `${value.slice(0, 8)}...`;
  }
}
