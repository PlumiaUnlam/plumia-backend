import { Test, type TestingModule } from '@nestjs/testing';
import { UserController } from '../../../src/user/user.controller';
import { UserService } from '../../../src/user/user.service';

describe('UserController', () => {
  let userController: UserController;
  const userService = { updateProfile: jest.fn(), deleteAccount: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [{ provide: UserService, useValue: userService }],
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
});
