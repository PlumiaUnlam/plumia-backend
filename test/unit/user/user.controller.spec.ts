import { Test, type TestingModule } from '@nestjs/testing';
import { UserController } from '../../../src/user/user.controller';

describe('UserController', () => {
  let userController: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
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
});
