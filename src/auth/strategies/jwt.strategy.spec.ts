import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { UserService } from '../../user/user.service';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;
  let userService: jest.Mocked<UserService>;

  const mockUser = {
    id: 'uuid-1',
    name: 'John',
    lastname: 'Doe',
    email: 'test@test.com',
    passwordHash: 'hashed_password',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: { getOrThrow: jest.fn().mockReturnValue('test_secret') },
        },
        {
          provide: UserService,
          useValue: { findById: jest.fn() },
        },
      ],
    }).compile();

    jwtStrategy = module.get(JwtStrategy);
    userService = module.get(UserService);
  });

  describe('validate', () => {
    it('should return id and email when the user exists', async () => {
      userService.findById.mockResolvedValue(mockUser);

      const result = await jwtStrategy.validate({
        sub: 'uuid-1',
        email: 'test@test.com',
      });

      expect(userService.findById).toHaveBeenCalledWith('uuid-1');
      expect(result).toEqual({ id: 'uuid-1', email: 'test@test.com' });
    });

    it('should throw UnauthorizedException when user is not found', async () => {
      userService.findById.mockResolvedValue(null);

      await expect(
        jwtStrategy.validate({ sub: 'uuid-999', email: 'ghost@test.com' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
