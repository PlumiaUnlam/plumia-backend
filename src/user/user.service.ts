import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { User } from './user.entity';

type PublicUser = Omit<User, 'passwordHash'>;

@Injectable()
export class UserService {
  private readonly users: User[] = [];

  findByEmail(email: string): Promise<User | undefined> {
    return Promise.resolve(this.users.find((u) => u.email === email));
  }

  findById(id: string): Promise<User | undefined> {
    return Promise.resolve(this.users.find((u) => u.id === id));
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
    return {
      id: user.id,
      email: user.email,
      createdAt: user.createdAt,
    };
  }
}
