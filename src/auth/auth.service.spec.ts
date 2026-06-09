import { ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import { PlanType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';

jest.mock('bcryptjs');

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let jwtService: jest.Mocked<JwtService>;

  const mockUser = {
    id: 'uuid-1',
    name: 'John',
    lastname: 'Doe',
    email: 'test@test.com',
    passwordHash: 'hashed_password',
    createdAt: new Date(),
    updatedAt: new Date(),
    displayName: null,
    avatarUrl: null,
    role: UserRole.AUTHOR,
    plan: PlanType.FREE,
    deletedAt: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: { sign: jest.fn() },
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    userService = module.get(UserService);
    jwtService = module.get(JwtService);
  });

  describe('validateUser', () => {
    it('should return id and email when credentials are valid', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await authService.validateUser(
        'test@test.com',
        'password123',
      );

      expect(result).toEqual({ id: 'uuid-1', email: 'test@test.com' });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'password123',
        'hashed_password',
      );
    });

    it('should return null when user does not exist', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await authService.validateUser(
        'notfound@test.com',
        'password123',
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('should return null when password is incorrect', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      const result = await authService.validateUser(
        'test@test.com',
        'wrong_password',
      );

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should return access_token signed with id and email', () => {
      jwtService.sign.mockReturnValue('jwt_token');

      const result = authService.login({
        id: 'uuid-1',
        email: 'test@test.com',
      });

      expect(result).toEqual({ access_token: 'jwt_token' });
      expect(jwtService.sign.mock.calls[0]?.[0]).toEqual({
        sub: 'uuid-1',
        email: 'test@test.com',
      });
    });
  });

  describe('register', () => {
    it('should create user and return access_token', async () => {
      userService.findByEmail.mockResolvedValue(null);
      userService.create.mockResolvedValue({
        id: 'uuid-1',
        name: 'John',
        lastname: 'Doe',
        email: 'new@test.com',
        passwordHash: 'hashed',
        createdAt: new Date(),
        updatedAt: new Date(),
        displayName: null,
        avatarUrl: null,
        role: UserRole.AUTHOR,
        plan: PlanType.FREE,
        deletedAt: null,
      });
      jwtService.sign.mockReturnValue('jwt_token');

      const result = await authService.register(
        'John',
        'Doe',
        'new@test.com',
        'password123',
      );

      expect(result).toEqual({ access_token: 'jwt_token' });
      expect(userService.create.mock.calls[0]).toEqual([
        'John',
        'Doe',
        'new@test.com',
        'password123',
      ]);
    });

    it('should throw ConflictException when email is already registered', async () => {
      userService.findByEmail.mockResolvedValue(mockUser);

      await expect(
        authService.register('John', 'Doe', 'test@test.com', 'password123'),
      ).rejects.toThrow(new ConflictException('Email already in use'));
      expect(userService.create.mock.calls).toHaveLength(0);
    });
  });
});
