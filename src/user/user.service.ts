import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { User } from './user.entity';

type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UserService {
  private readonly users: User[] = [];

  async findByEmail(email: string): Promise<User | undefined> {
    return this.users.find((u) => u.email === email);
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.find((u) => u.id === id);
  }

  async create(email: string, password: string): Promise<PublicUser> {
    const passwordHash = await bcrypt.hash(password, 10);
    const user: User = {
      id: randomUUID(),
      email,
      passwordHash,
      createdAt: new Date(),
    };
    this.users.push(user);
    const { passwordHash: _, ...publicUser } = user;
    return publicUser;
  }
}
