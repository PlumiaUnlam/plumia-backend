import { UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { LocalStrategy } from './local.strategy';

describe('LocalStrategy', () => {
  let localStrategy: LocalStrategy;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LocalStrategy,
        {
          provide: AuthService,
          useValue: { validateUser: jest.fn() },
        },
      ],
    }).compile();

    localStrategy = module.get(LocalStrategy);
    authService = module.get(AuthService);
  });

  describe('validate', () => {
    it('should return the user when credentials are valid', async () => {
      authService.validateUser.mockResolvedValue({
        id: 'uuid-1',
        email: 'test@test.com',
      });

      const result = await localStrategy.validate('test@test.com', 'password123');

      expect(authService.validateUser).toHaveBeenCalledWith(
        'test@test.com',
        'password123',
      );
      expect(result).toEqual({ id: 'uuid-1', email: 'test@test.com' });
    });

    it('should throw UnauthorizedException when validateUser returns null', async () => {
      authService.validateUser.mockResolvedValue(null);

      await expect(
        localStrategy.validate('test@test.com', 'wrong_password'),
      ).rejects.toThrow(new UnauthorizedException('Invalid credentials'));
    });
  });
});
