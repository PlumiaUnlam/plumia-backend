import { Test, type TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { UserService, type UserEntity } from '../../../src/user/user.service';

describe('UserService', () => {
  let userService: UserService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock };
  };

  const mockUser: UserEntity = {
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
        UserService,
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: jest.fn(),
              create: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    userService = module.get(UserService);
    prisma = module.get(PrismaService);
  });

  describe('findByEmail', () => {
    it('should return the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await userService.findByEmail('test@test.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
    });

    it('should return null when no user matches the email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.findByEmail('missing@test.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return the user when found', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await userService.findById('firebase-uid-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'firebase-uid-1' },
      });
    });

    it('should return null when no user matches the id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.findById('firebase-uid-999');

      expect(result).toBeNull();
    });
  });

  describe('createFromFirebase', () => {
    it('should create a user from Firebase data', async () => {
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await userService.createFromFirebase({
        uid: 'firebase-uid-1',
        email: 'test@test.com',
        name: 'John',
        lastname: 'Doe',
        avatarUrl: 'https://example.com/avatar.png',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          id: 'firebase-uid-1',
          email: 'test@test.com',
          name: 'John',
          lastname: 'Doe',
          avatarUrl: 'https://example.com/avatar.png',
        },
      });
      expect(result).toEqual(mockUser);
    });
  });
});
