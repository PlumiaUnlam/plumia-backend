import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

export interface UserEntity {
  id: string;
  name: string;
  lastname: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}

interface UserWhereUniqueArgs {
  where: {
    email?: string;
    id?: string;
  };
}

interface UserCreateArgs {
  data: {
    name: string;
    lastname: string;
    email: string;
    passwordHash: string;
  };
}

interface PrismaUserClient {
  user: {
    findUnique: (args: UserWhereUniqueArgs) => Promise<UserEntity | null>;
    create: (args: UserCreateArgs) => Promise<UserEntity>;
  };
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<UserEntity | null> {
    return (this.prisma as unknown as PrismaUserClient).user.findUnique({
      where: { email },
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return (this.prisma as unknown as PrismaUserClient).user.findUnique({
      where: { id },
    });
  }

  async create(
    name: string,
    lastname: string,
    email: string,
    password: string,
  ): Promise<UserEntity> {
    const passwordHash = await bcrypt.hash(password, 10);
    return (this.prisma as unknown as PrismaUserClient).user.create({
      data: { name, lastname, email, passwordHash },
    });
  }
}
