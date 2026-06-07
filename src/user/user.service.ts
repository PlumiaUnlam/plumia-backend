import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async create(
    name: string,
    lastname: string,
    email: string,
    password: string,
  ) {
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: { name, lastname, email, passwordHash },
    });
  }
}
