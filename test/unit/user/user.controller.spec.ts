import { Test, type TestingModule } from '@nestjs/testing';
import { UserController } from '../../../src/user/user.controller';
import { UserService } from '../../../src/user/user.service';
import { UserApiKeyService } from '../../../src/user/user-api-key.service';

describe('UserController', () => {
  let userController: UserController;
  const userService = { updateProfile: jest.fn(), deleteAccount: jest.fn() };
  const userApiKeys = {
    getGeminiSettings: jest.fn(),
    saveGeminiKey: jest.fn(),
    removeGeminiKey: jest.fn(),
    updateAutoAnalyzeOnAutosave: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [
        { provide: UserService, useValue: userService },
        { provide: UserApiKeyService, useValue: userApiKeys },
      ],
    }).compile();

    userController = module.get(UserController);
  });

  describe('getMe', () => {
    it('should return the authenticated user from the request', () => {
      const req = { user: { id: 'uuid-1', email: 'test@test.com' } };

      const result = userController.getMe(req);

      expect(result).toEqual({ id: 'uuid-1', email: 'test@test.com' });
    });
  });

  describe('updateMe', () => {
    it('updates the authenticated user profile', async () => {
      userService.updateProfile.mockResolvedValue({ id: 'uuid-1' });

      await userController.updateMe(
        { user: { id: 'uuid-1' } },
        { displayName: '  Ailen  ', avatarUrl: null },
      );

      expect(userService.updateProfile).toHaveBeenCalledWith('uuid-1', {
        displayName: 'Ailen',
        avatarUrl: null,
      });
    });
  });

  describe('deleteMe', () => {
    it('deletes the account of the authenticated user', async () => {
      userService.deleteAccount.mockResolvedValue(undefined);

      // `id` es el de la fila y `uid` el del token: el que va a Firebase es
      // el segundo.
      await userController.deleteMe({
        user: { id: 'uuid-1', uid: 'token-uid-1' },
      });

      expect(userService.deleteAccount).toHaveBeenCalledWith(
        'uuid-1',
        'token-uid-1',
      );
    });
  });

  describe('AI settings', () => {
    it('returns masked Gemini key metadata for the authenticated user', async () => {
      const settings = {
        configured: true,
        keyPrefix: 'AIzaTest...',
        updatedAt: new Date(),
        autoAnalyzeOnAutosave: true,
      };
      userApiKeys.getGeminiSettings.mockResolvedValue(settings);

      await expect(
        userController.getAiSettings({ user: { id: 'uuid-1' } }),
      ).resolves.toBe(settings);
      expect(userApiKeys.getGeminiSettings).toHaveBeenCalledWith('uuid-1');
    });

    it('trims and stores the submitted Gemini key for the authenticated user', async () => {
      userApiKeys.saveGeminiKey.mockResolvedValue({ configured: true });

      await userController.saveGeminiApiKey(
        { user: { id: 'uuid-1' } },
        { apiKey: '  user-key  ' },
      );

      expect(userApiKeys.saveGeminiKey).toHaveBeenCalledWith(
        'uuid-1',
        'user-key',
      );
    });

    it('removes the Gemini key for the authenticated user', async () => {
      userApiKeys.removeGeminiKey.mockResolvedValue(undefined);

      await userController.removeGeminiApiKey({ user: { id: 'uuid-1' } });

      expect(userApiKeys.removeGeminiKey).toHaveBeenCalledWith('uuid-1');
    });

    it('updates the automatic analysis preference for the authenticated user', async () => {
      const settings = {
        configured: false,
        keyPrefix: null,
        updatedAt: null,
        autoAnalyzeOnAutosave: false,
      };
      userApiKeys.updateAutoAnalyzeOnAutosave.mockResolvedValue(settings);

      await expect(
        userController.updateAutoAnalysis(
          { user: { id: 'uuid-1' } },
          { enabled: false },
        ),
      ).resolves.toBe(settings);
      expect(userApiKeys.updateAutoAnalyzeOnAutosave).toHaveBeenCalledWith(
        'uuid-1',
        false,
      );
    });
  });
});
