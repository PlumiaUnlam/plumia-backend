import { Test, type TestingModule } from '@nestjs/testing';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';
import { LoginDto } from '../../../src/auth/dto/login.dto';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: jest.Mocked<AuthService>;

  const mockUser = {
    id: 'firebase-uid-1',
    name: 'John',
    lastname: 'Doe',
    email: 'test@test.com',
    createdAt: new Date(),
    updatedAt: new Date(),
    displayName: null,
    avatarUrl: null,
    role: 'AUTHOR' as const,
    plan: 'FREE' as const,
    deletedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: { login: jest.fn() },
        },
      ],
    }).compile();

    authController = module.get(AuthController);
    authService = module.get(AuthService);
  });

  describe('login', () => {
    it('should call authService.login with idToken and return the user', async () => {
      const dto: LoginDto = { idToken: 'firebase-id-token' };
      authService.login.mockResolvedValue(mockUser);

      const result = await authController.login(dto);

      expect(authService.login).toHaveBeenCalledWith('firebase-id-token');
      expect(result).toEqual({
        user: {
          id: mockUser.id,
          name: mockUser.name,
          lastname: mockUser.lastname,
          email: mockUser.email,
          createdAt: mockUser.createdAt,
          updatedAt: mockUser.updatedAt,
          displayName: mockUser.displayName,
          avatarUrl: mockUser.avatarUrl,
          role: mockUser.role,
          plan: mockUser.plan,
        },
      });
    });
  });
});
