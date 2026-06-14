import { Injectable } from '@nestjs/common';
import { type User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type UserEntity = User;

export interface CreateFromFirebaseParams {
  uid: string;
  email: string;
  name: string;
  lastname?: string;
  avatarUrl?: string | null;
}

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { email },
    });
  }

  findById(id: string): Promise<UserEntity | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  createFromFirebase(params: CreateFromFirebaseParams): Promise<UserEntity> {
    return this.prisma.user.create({
      data: {
        id: params.uid,
        email: params.email,
        name: params.name,
        lastname: params.lastname ?? '',
        avatarUrl: params.avatarUrl ?? null,
      },
    });
  }
}
