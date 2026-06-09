import { Test, type TestingModule } from '@nestjs/testing';
import { AuthController } from '../../../src/auth/auth.controller';
import { AuthService } from '../../../src/auth/auth.service';
import { type RegisterDto } from '../../../src/auth/dto/register.dto';

describe('AuthController', () => {
  let authController: AuthController;
  let authService: jest.Mocked<AuthService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn(),
            register: jest.fn(),
          },
        },
      ],
    }).compile();

    authController = module.get(AuthController);
    authService = module.get(AuthService);
  });

  describe('login', () => {
    it('should call authService.login with req.user and return the token', () => {
      const req = { user: { id: 'uuid-1', email: 'test@test.com' } };
      authService.login.mockReturnValue({ access_token: 'jwt_token' });

      const result = authController.login(req);

      expect(authService.login).toHaveBeenCalledWith(req.user);
      expect(result).toEqual({ access_token: 'jwt_token' });
    });
  });

  describe('register', () => {
    it('should call authService.register with DTO fields and return the token', async () => {
      const dto: RegisterDto = {
        name: 'John',
        lastname: 'Doe',
        email: 'test@test.com',
        password: 'password123',
      };
      authService.register.mockResolvedValue({ access_token: 'jwt_token' });

      const result = await authController.register(dto);

      expect(authService.register).toHaveBeenCalledWith(
        'John',
        'Doe',
        'test@test.com',
        'password123',
      );
      expect(result).toEqual({ access_token: 'jwt_token' });
    });
  });
});
