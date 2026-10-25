import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ACCOUNT_DELETED_MESSAGE,
  AuthService,
} from '../../../src/auth/auth.service';
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
    autoAnalyzeOnAutosave: true,
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
            backfillFromFirebase: jest.fn(),
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
        lastname: '',
        displayName: 'Jane',
        avatarUrl: 'https://example.com/avatar.png',
      });
      expect(result.email).toBe('new@test.com');
    });

    it('should persist the username as displayName', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-username',
        email: 'username@test.com',
        name: 'Jane Doe',
      } as never);
      userService.findById.mockResolvedValue(null);
      userService.createFromFirebase.mockResolvedValue({
        ...mockUser,
        id: 'firebase-uid-username',
      });

      await authService.login('valid-token', {
        firstName: 'Jane',
        lastName: 'Doe',
        username: 'jane.doe',
      });

      expect(userService.createFromFirebase).toHaveBeenCalledWith({
        uid: 'firebase-uid-username',
        email: 'username@test.com',
        name: 'Jane',
        lastname: 'Doe',
        displayName: 'jane.doe',
        avatarUrl: null,
      });
    });

    it('should prefer the profile firstName and lastName over the Firebase name', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-profile',
        email: 'profile@test.com',
        name: 'Firebase Name',
      } as never);
      userService.findById.mockResolvedValue(null);
      userService.createFromFirebase.mockResolvedValue({
        ...mockUser,
        id: 'firebase-uid-profile',
      });

      await authService.login('valid-token', {
        firstName: 'Jane',
        lastName: 'Doe',
      });

      expect(userService.createFromFirebase).toHaveBeenCalledWith({
        uid: 'firebase-uid-profile',
        email: 'profile@test.com',
        name: 'Jane',
        lastname: 'Doe',
        displayName: 'Firebase Name',
        avatarUrl: null,
      });
    });

    it('should throw UnauthorizedException when Firebase token is invalid', async () => {
      firebaseAdmin.verifyToken.mockRejectedValue(new Error('Invalid token'));

      await expect(authService.login('bad-token')).rejects.toThrow(
        UnauthorizedException,
      );
      expect(userService.findById).not.toHaveBeenCalled();
    });
  });

  describe('backfill of an existing user', () => {
    it('fills empty name, lastname and displayName when the register profile arrives late', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
        name: 'jane.doe',
      } as never);
      userService.findById.mockResolvedValue({
        ...mockUser,
        name: '',
        lastname: '',
        displayName: null,
      });
      userService.backfillFromFirebase.mockResolvedValue({
        ...mockUser,
        name: 'Jane',
        lastname: 'Doe',
        displayName: 'jane.doe',
      });

      const result = await authService.login('valid-token', {
        firstName: 'Jane',
        lastName: 'Doe',
        username: 'jane.doe',
      });

      expect(userService.backfillFromFirebase).toHaveBeenCalledWith(
        'firebase-uid-1',
        { name: 'Jane', lastname: 'Doe', displayName: 'jane.doe' },
      );
      expect(result.displayName).toBe('jane.doe');
    });

    it('never overwrites values the user already has', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
        name: 'otro-nombre',
      } as never);
      const stored = { ...mockUser, displayName: 'jane.doe' };
      userService.findById.mockResolvedValue(stored);

      const result = await authService.login('valid-token', {
        firstName: 'Jane',
        lastName: 'Doe',
        username: 'jane.nueva',
      });

      expect(userService.backfillFromFirebase).not.toHaveBeenCalled();
      expect(result).toBe(stored);
    });

    it('does not write the Firebase name claim into name on a plain login', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
        name: 'jane.doe',
      } as never);
      const stored = { ...mockUser, name: '', lastname: '', displayName: null };
      userService.findById.mockResolvedValue(stored);
      userService.backfillFromFirebase.mockResolvedValue({
        ...stored,
        displayName: 'jane.doe',
      });

      await authService.login('valid-token');

      expect(userService.backfillFromFirebase).toHaveBeenCalledWith(
        'firebase-uid-1',
        { displayName: 'jane.doe' },
      );
      expect(userService.backfillFromFirebase).not.toHaveBeenCalledWith(
        'firebase-uid-1',
        expect.objectContaining({ name: 'jane.doe' }),
      );
    });

    it('leaves the row untouched when there is nothing empty to fill', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
      } as never);
      const stored = {
        ...mockUser,
        name: 'John',
        lastname: 'Doe',
        displayName: 'jd',
      };
      userService.findById.mockResolvedValue(stored);

      const result = await authService.login('valid-token');

      expect(userService.backfillFromFirebase).not.toHaveBeenCalled();
      expect(result).toBe(stored);
    });

    it('backfills a user found by email as well', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-new',
        email: 'test@test.com',
      } as never);
      userService.findById.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        id: 'legacy-id',
        displayName: null,
      });
      userService.backfillFromFirebase.mockResolvedValue({
        ...mockUser,
        id: 'legacy-id',
        displayName: 'jane.doe',
      });

      await authService.login('valid-token', { username: 'jane.doe' });

      expect(userService.backfillFromFirebase).toHaveBeenCalledWith(
        'legacy-id',
        { displayName: 'jane.doe' },
      );
    });
  });

  describe('resolveExistingUserId', () => {
    it('maps a Firebase identity to an existing user with the same email', async () => {
      userService.findById.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        id: 'legacy-owner-id',
      });

      await expect(
        authService.resolveExistingUserId({
          uid: 'new-firebase-uid',
          email: mockUser.email,
        }),
      ).resolves.toBe('legacy-owner-id');

      expect(userService.findById).toHaveBeenCalledWith('new-firebase-uid');
      expect(userService.findByEmail).toHaveBeenCalledWith(mockUser.email);
      expect(userService.createFromFirebase).not.toHaveBeenCalled();
    });

    it('keeps the Firebase uid for an invited reader without a local account', async () => {
      userService.findById.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue(null);

      await expect(
        authService.resolveExistingUserId({
          uid: 'reader-firebase-uid',
          email: 'reader@example.com',
        }),
      ).resolves.toBe('reader-firebase-uid');

      expect(userService.createFromFirebase).not.toHaveBeenCalled();
    });
  });

  describe('suppressed accounts (Ley 25.326, art. 16)', () => {
    it('tells a returning user that the account was deleted, not that the session went bad', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
      } as never);
      userService.findById.mockResolvedValue({
        ...mockUser,
        email: 'deleted-firebase-uid-1@plumia.invalid',
        name: 'Usuario eliminado',
        deletedAt: new Date(),
      });

      const rejection = await authService
        .login('valid-token')
        .catch((error: unknown) => error);

      // Se distingue a propósito. Para llegar acá hizo falta presentar un ID
      // token de Firebase vigente para esa cuenta, así que no se le delata
      // nada que no pueda comprobar por su cuenta, y se le ahorra perseguir un
      // error de sesión genérico que no se va a arreglar con reintentar.
      expect(rejection).toBeInstanceOf(ForbiddenException);
      expect(rejection).toMatchObject({
        status: 403,
        message: ACCOUNT_DELETED_MESSAGE,
      });
      expect(userService.backfillFromFirebase).not.toHaveBeenCalled();
      expect(userService.createFromFirebase).not.toHaveBeenCalled();
    });

    it('does not map a suppressed account to a share link', async () => {
      userService.findById.mockResolvedValue({
        ...mockUser,
        deletedAt: new Date(),
      });

      // Acá NO se distingue: fuera del login lo único que importa es que la
      // sesión no vale, y delatar la baja no le sirve a nadie.
      await expect(
        authService.resolveExistingUserId({ uid: 'firebase-uid-1' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('creates a fresh account when the email belonged to a suppressed account', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-2',
        email: 'test@test.com',
      } as never);
      // El tombstone reescribió su email, así que el correo real ya no matchea
      // ninguna fila: no hay con qué continuar la cuenta anterior.
      userService.findById.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue(null);
      userService.createFromFirebase.mockResolvedValue(mockUser);

      const result = await authService.login('valid-token');

      expect(userService.findByEmail).toHaveBeenCalledWith('test@test.com');
      expect(userService.createFromFirebase).toHaveBeenCalledWith(
        expect.objectContaining({
          uid: 'firebase-uid-2',
          email: 'test@test.com',
        }),
      );
      expect(userService.backfillFromFirebase).not.toHaveBeenCalled();
      expect(result).toEqual(mockUser);
    });

    it('rejects a login when the email still maps to a tombstone', async () => {
      firebaseAdmin.verifyToken.mockResolvedValue({
        uid: 'firebase-uid-2',
        email: 'deleted-firebase-uid-1@plumia.invalid',
      } as never);
      userService.findById.mockResolvedValue(null);
      userService.findByEmail.mockResolvedValue({
        ...mockUser,
        email: 'deleted-firebase-uid-1@plumia.invalid',
        deletedAt: new Date(),
      });

      await expect(authService.login('valid-token')).rejects.toThrow(
        ForbiddenException,
      );
      expect(userService.createFromFirebase).not.toHaveBeenCalled();
    });
  });
});
