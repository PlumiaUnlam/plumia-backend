import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { UserApiKeyService } from './user-api-key.service';
import { DEFAULT_ENTITY_RECOGNITION_THRESHOLDS } from '../system/entity-extraction/entity-recognition-settings';

describe('UserApiKeyService', () => {
  const encryptionKey = 'a'.repeat(64);
  const config = {
    get: jest.fn((key: string, fallback = '') =>
      key === 'ENCRYPTION_KEY' ? encryptionKey : fallback,
    ),
  };

  it('encrypts a Gemini key and replaces the active key', async () => {
    const created = {
      keyPrefix: 'AIzaTest...',
      updatedAt: new Date(),
    };
    const tx = {
      userApiKey: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ autoAnalyzeOnAutosave: true }),
      },
      userApiKey: {
        findFirst: jest.fn().mockResolvedValue(created),
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...created, provider: 'gemini' }]),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    const result = await service.saveGeminiKey('user-id', 'AIzaSecretValue');

    expect(result).toMatchObject({
      configured: true,
      keyPrefix: created.keyPrefix,
      updatedAt: created.updatedAt,
      autoAnalyzeOnAutosave: true,
      entityExtractionThresholds: DEFAULT_ENTITY_RECOGNITION_THRESHOLDS,
      provider: 'gemini',
      model: 'gemini-2.5-flash',
      credentialSource: 'USER',
    });
    expect(tx.userApiKey.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', provider: 'gemini', isActive: true },
      data: { isActive: false },
    });
    interface CreateData {
      encryptedKey: unknown;
      iv: unknown;
      tag: unknown;
      keyPrefix: string;
      isActive: boolean;
      provider: string;
      userId: string;
    }
    const createCalls = tx.userApiKey.create.mock.calls as unknown as Array<
      [{ data: CreateData }]
    >;
    const createData = createCalls[0]?.[0]?.data;
    expect(createData).toBeDefined();
    if (!createData) {
      throw new Error('Expected encrypted key data');
    }
    expect(createData).toMatchObject({
      userId: 'user-id',
      provider: 'gemini',
      keyPrefix: 'AIzaSecr...',
      isActive: true,
    });
    expect(createData.encryptedKey).not.toBe('AIzaSecretValue');
    expect(createData.iv).toBeInstanceOf(Buffer);
    expect(createData.tag).toBeInstanceOf(Buffer);
  });

  it('reports metadata without returning the stored key', async () => {
    const updatedAt = new Date();
    const prisma = {
      userApiKey: {
        findFirst: jest.fn().mockResolvedValue({
          keyPrefix: 'AIzaSec...',
          updatedAt,
        }),
        findMany: jest
          .fn()
          .mockResolvedValue([
            { provider: 'gemini', keyPrefix: 'AIzaSec...', updatedAt },
          ]),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: true,
        }),
      },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(service.getGeminiSettings('user-id')).resolves.toMatchObject({
      configured: true,
      keyPrefix: 'AIzaSec...',
      updatedAt,
      autoAnalyzeOnAutosave: true,
      entityExtractionThresholds: DEFAULT_ENTITY_RECOGNITION_THRESHOLDS,
      provider: 'gemini',
      credentialSource: 'USER',
    });
    expect(prisma.userApiKey.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-id',
          provider: { in: ['gemini', 'anthropic'] },
          isActive: true,
        },
      }),
    );
  });

  it('stores an Anthropic key separately and returns metadata only', async () => {
    const created = { keyPrefix: 'sk-ant-a...', updatedAt: new Date() };
    const tx = {
      userApiKey: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue(created),
      },
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ autoAnalyzeOnAutosave: true }),
      },
      userApiKey: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ ...created, provider: 'anthropic' }]),
      },
      userAiProviderSettings: { findUnique: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    const result = await service.saveProviderKey(
      'user-id',
      'anthropic',
      'sk-ant-secret-value',
    );

    expect(
      result.providers.find((provider) => provider.provider === 'anthropic'),
    ).toMatchObject({ userKeyConfigured: true, keyPrefix: 'sk-ant-a...' });
    expect(tx.userApiKey.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', provider: 'anthropic', isActive: true },
      data: { isActive: false },
    });
    const createData = tx.userApiKey.create.mock.calls[0]?.[0]?.data;
    expect(createData.provider).toBe('anthropic');
    expect(createData.encryptedKey).not.toBe('sk-ant-secret-value');
  });

  it('requires the selected user key and does not fall back to a server key', async () => {
    const serverConfig = {
      get: jest.fn((key: string, fallback = '') => {
        if (key === 'ANTHROPIC_API_KEY') return 'server-anthropic-key';
        if (key === 'ENCRYPTION_KEY') return encryptionKey;
        return fallback;
      }),
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ autoAnalyzeOnAutosave: true }),
      },
      userApiKey: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue({
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          credentialSource: 'USER',
        }),
      },
    };
    const service = new UserApiKeyService(
      prisma as never,
      serverConfig as never,
    );

    await expect(
      service.getExtractionProviderConfiguration('user-id'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('uses the selected server provider and model for extraction', async () => {
    const serverConfig = {
      get: jest.fn((key: string, fallback = '') => {
        if (key === 'ANTHROPIC_API_KEY') return 'server-anthropic-key';
        if (key === 'ENCRYPTION_KEY') return encryptionKey;
        return fallback;
      }),
    };
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ autoAnalyzeOnAutosave: true }),
      },
      userApiKey: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue({
          provider: 'anthropic',
          model: 'claude-custom-model',
          credentialSource: 'SERVER',
        }),
      },
    };
    const service = new UserApiKeyService(
      prisma as never,
      serverConfig as never,
    );

    await expect(
      service.getExtractionProviderConfiguration('user-id'),
    ).resolves.toEqual({
      provider: 'anthropic',
      model: 'claude-custom-model',
      credentialSource: 'SERVER',
      apiKey: 'server-anthropic-key',
    });
  });

  it('rejects the server credential source when that provider has no key', async () => {
    const prisma = {
      userAiProviderSettings: { upsert: jest.fn() },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(
      service.updateAiProviderSettings('user-id', {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        credentialSource: 'SERVER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userAiProviderSettings.upsert).not.toHaveBeenCalled();
  });

  it('rejects selecting a personal key that has not been saved', async () => {
    const prisma = {
      userApiKey: { findFirst: jest.fn().mockResolvedValue(null) },
      userAiProviderSettings: { upsert: jest.fn() },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(
      service.updateAiProviderSettings('user-id', {
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        credentialSource: 'USER',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.userAiProviderSettings.upsert).not.toHaveBeenCalled();
  });

  it('fails clearly when encryption is not configured before storing a key', async () => {
    const missingConfig = { get: jest.fn().mockReturnValue('') };
    const prisma = { $transaction: jest.fn() };
    const service = new UserApiKeyService(
      prisma as never,
      missingConfig as never,
    );

    await expect(
      service.saveGeminiKey('user-id', 'AIzaSecretValue'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('removes all Gemini keys for the authenticated user only', async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      userApiKey: { deleteMany },
      userAiProviderSettings: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await service.removeGeminiKey('user-id');

    expect(deleteMany).toHaveBeenCalledWith({
      where: { userId: 'user-id', provider: 'gemini' },
    });
  });

  it('updates the automatic analysis preference without exposing the API key', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'user-id' });
    const prisma = {
      user: {
        update,
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: false,
        }),
      },
      userApiKey: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(
      service.updateAutoAnalyzeOnAutosave('user-id', false),
    ).resolves.toMatchObject({
      configured: false,
      keyPrefix: null,
      updatedAt: null,
      autoAnalyzeOnAutosave: false,
      provider: 'gemini',
      credentialSource: 'SERVER',
      entityExtractionThresholds: DEFAULT_ENTITY_RECOGNITION_THRESHOLDS,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { autoAnalyzeOnAutosave: false },
    });
  });

  it('stores recognition thresholds separately from the user profile', async () => {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      userEntityRecognitionSettings: {
        upsert,
        findUnique: jest.fn().mockResolvedValue({
          thresholds: { CHARACTER: 0.4, OBJECT: 0.95 },
        }),
      },
      userApiKey: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      userAiProviderSettings: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ autoAnalyzeOnAutosave: true }),
      },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(
      service.updateEntityRecognitionThresholds('user-id', {
        CHARACTER: 0.4,
        LOCATION: 0.65,
        OBJECT: 0.95,
        ORGANIZATION: 0.7,
        EVENT: 0.75,
        CONCEPT: 0.8,
      }),
    ).resolves.toMatchObject({
      entityExtractionThresholds: {
        CHARACTER: 0.4,
        LOCATION: 0.65,
        OBJECT: 0.95,
      },
    });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
