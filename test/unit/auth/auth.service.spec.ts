import { UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuthService } from '../../../src/auth/auth.service';
import { FirebaseAdminService } from '../../../src/auth/firebase-admin.service';
import { UserService } from '../../../src/user/user.service';

describe('AuthService', () => {
  let authService: AuthService;
  let userService: jest.Mocked<UserService>;
  let firebaseAdmin: jest.Mocked<FirebaseAdminService>;

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
      providers: [
        AuthService,
        {
          provide: UserService,
          useValue: {
            findById: jest.fn(),
            findByEmail: jest.fn(),
            createFromFirebase: jest.fn(),
          },
        },
        {
          provide: FirebaseAdminService,
          useValue: { verifyToken: jest.fn() },
        },
      ],
    }).compile();

    authService = module.get(AuthService);
    userService = module.get(UserService);
    firebaseAdmin = module.get(FirebaseAdminService);
  });

  describe('login', () => {
    it('should return existing user when Firebase token is valid', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
      } as never);
      userService.findById.mockResolvedValue(mockUser);

      const result = await authService.login('valid-token');

      expect(firebaseAdmin.verifyToken).toHaveBeenCalledWith('valid-token');
      expect(userService.findById).toHaveBeenCalledWith('firebase-uid-1');
      expect(userService.createFromFirebase).not.toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('should create user when Firebase uid does not exist locally', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-new',
        email: 'new@test.com',
        name: 'Jane',
        picture: 'https://example.com/avatar.png',
      } as never);
      userService.findById.mockResolvedValue(null);
      userService.createFromFirebase.mockResolvedValue({
        ...mockUser,
        id: 'firebase-uid-new',
        email: 'new@test.com',
        avatarUrl: 'https://example.com/avatar.png',
      });

      const result = await authService.login('valid-token');

      expect(userService.createFromFirebase).toHaveBeenCalledWith({
        uid: 'firebase-uid-new',
        email: 'new@test.com',
        name: 'Jane',
        avatarUrl: 'https://example.com/avatar.png',
      });
      expect(result.email).toBe('new@test.com');
    });

    it('should throw UnauthorizedException when Firebase token is invalid', async () => {
      firebaseAdmin.verifyToken.mockRejectedValue(new Error('Invalid token'));

      await expect(authService.login('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userService.findById).not.toHaveBeenCalled();
    });
  });
});
