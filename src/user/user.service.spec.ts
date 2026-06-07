import { Test, type TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from './user.service';

jest.mock('bcryptjs');

describe('UserService', () => {
  let userService: UserService;
  let prisma: jest.Mocked<PrismaService>;

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
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await userService.findByEmail('test@test.com');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'test@test.com' },
      });
    });

    it('should return null when no user matches the email', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await userService.findByEmail('missing@test.com');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should return the user when found', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser);

      const result = await userService.findById('uuid-1');

      expect(result).toEqual(mockUser);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'uuid-1' },
      });
    });

    it('should return null when no user matches the id', async () => {
      (prisma.user.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await userService.findById('uuid-999');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should hash the password and persist the user', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      (prisma.user.create as jest.Mock).mockResolvedValue(mockUser);

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
