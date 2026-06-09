import { Test, type TestingModule } from '@nestjs/testing';
import { PlanType, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserService, type UserEntity } from './user.service';

jest.mock('bcryptjs');

type BcryptHash = (password: string, salt: number) => Promise<string>;

interface MockPrismaService {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
}

describe('UserService', () => {
  let userService: UserService;
  let prisma: MockPrismaService;

  const mockUser: UserEntity = {
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
    prisma = module.get<MockPrismaService>(PrismaService);
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

      const result = await userService.findById('uuid-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should return null when no user matches the id', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.findById('uuid-999');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should hash the password and persist the user', async () => {
      jest
        .mocked(bcrypt.hash as BcryptHash)
        .mockResolvedValue('hashed_password');
      prisma.user.create.mockResolvedValue(mockUser);

      const result = await userService.create(
        'John',
        'Doe',
        'test@test.com',
        'plaintext',
      );

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext', 10);
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          name: 'John',
          lastname: 'Doe',
          email: 'test@test.com',
          passwordHash: 'hashed_password',
        },
      });
      expect(result).toEqual(mockUser);
    });
  });
});
