import { ServiceUnavailableException } from '@nestjs/common';
import { UserApiKeyService } from './user-api-key.service';

describe('UserApiKeyService', () => {
  const encryptionKey = 'a'.repeat(64);
  const config = {
    get: jest.fn().mockReturnValue(encryptionKey),
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
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    const result = await service.saveGeminiKey('user-id', 'AIzaSecretValue');

    expect(result).toEqual({
      configured: true,
      keyPrefix: created.keyPrefix,
      updatedAt: created.updatedAt,
      autoAnalyzeOnAutosave: true,
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
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          autoAnalyzeOnAutosave: true,
        }),
      },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(service.getGeminiSettings('user-id')).resolves.toEqual({
      configured: true,
      keyPrefix: 'AIzaSec...',
      updatedAt,
      autoAnalyzeOnAutosave: true,
    });
    expect(prisma.userApiKey.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-id', provider: 'gemini', isActive: true },
      }),
    );
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
    const prisma = { userApiKey: { deleteMany } };
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
      },
    };
    const service = new UserApiKeyService(prisma as never, config as never);

    await expect(
      service.updateAutoAnalyzeOnAutosave('user-id', false),
    ).resolves.toEqual({
      configured: false,
      keyPrefix: null,
      updatedAt: null,
      autoAnalyzeOnAutosave: false,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'user-id' },
      data: { autoAnalyzeOnAutosave: false },
    });
  });
});
