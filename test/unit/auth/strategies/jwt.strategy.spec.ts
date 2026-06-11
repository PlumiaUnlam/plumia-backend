import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { JwtStrategy } from '../../../../src/auth/strategies/jwt.strategy';
import { UserService } from '../../../../src/user/user.service';

describe('JwtStrategy', () => {
  let jwtStrategy: JwtStrategy;
  let userService: jest.Mocked<UserService>;

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
    it('should return the hardcoded dev user without checking persistence', async () => {
      const result = await jwtStrategy.validate({
        sub: 'uuid-1',
        email: 'test@test.com',
      });

      expect(userService.findById).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: '5427d530-246e-4c45-8f98-4c5747f4eddb',
        email: 'user@example.com',
      });
    });

    it('should ignore missing users while JWT validation is hardcoded for dev', async () => {
      const result = await jwtStrategy.validate({
        sub: 'uuid-999',
        email: 'ghost@test.com',
      });

      expect(userService.findById).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: '5427d530-246e-4c45-8f98-4c5747f4eddb',
        email: 'user@example.com',
      });
    });
  });
});
