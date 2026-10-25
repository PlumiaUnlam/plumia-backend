import {
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AiSettingsResponseDto } from './dto/ai-settings-response.dto';

const GEMINI_PROVIDER = 'gemini';
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

  async getGeminiSettings(userId: string): Promise<AiSettingsResponseDto> {
    const record = await this.prisma.userApiKey.findFirst({
      where: { userId, provider: GEMINI_PROVIDER, isActive: true },
      select: { keyPrefix: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    return {
      configured: Boolean(record),
      keyPrefix: record?.keyPrefix ?? null,
      updatedAt: record?.updatedAt ?? null,
    };
  }

  async saveGeminiKey(
    userId: string,
    apiKey: string,
  ): Promise<AiSettingsResponseDto> {
    const normalizedKey = apiKey.trim();
    if (!normalizedKey) {
      throw new InternalServerErrorException('La API Key no puede estar vacia');
    }

    const encrypted = this.encrypt(normalizedKey);
    const keyPrefix = this.toKeyPrefix(normalizedKey);
    const record = await this.prisma.$transaction(async (tx) => {
      await tx.userApiKey.updateMany({
        where: { userId, provider: GEMINI_PROVIDER, isActive: true },
        data: { isActive: false },
      });

      return tx.userApiKey.create({
        data: {
          userId,
          provider: GEMINI_PROVIDER,
          encryptedKey: encrypted.encryptedKey,
          iv: encrypted.iv,
          tag: encrypted.tag,
          keyPrefix,
          isActive: true,
        },
        select: { keyPrefix: true, updatedAt: true },
      });
    });

    return {
      configured: true,
      keyPrefix: record.keyPrefix,
      updatedAt: record.updatedAt,
    };
  }

  async removeGeminiKey(userId: string): Promise<void> {
    await this.prisma.userApiKey.deleteMany({
      where: { userId, provider: GEMINI_PROVIDER },
    });
  }

  async getActiveGeminiKey(userId: string): Promise<string | null> {
    const record = await this.prisma.userApiKey.findFirst({
      where: { userId, provider: GEMINI_PROVIDER, isActive: true },
      select: { encryptedKey: true, iv: true, tag: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (!record) {
      return null;
    }

    return this.decrypt(record);
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
      throw new Error('Stored Gemini API key could not be decrypted');
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
