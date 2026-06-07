import { Injectable, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUser(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string } | null> {
    const user = await this.userService.findByEmail(email);
    if (!user) return null;

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return null;

    return { id: user.id, email: user.email };
  }

  login(user: { id: string; email: string }): { access_token: string } {
    const payload = { sub: user.id, email: user.email };
    return { access_token: this.jwtService.sign(payload) };
  }

  async register(
    name: string,
    lastname: string,
    email: string,
    password: string,
  ): Promise<{ access_token: string }> {
    const existing = await this.userService.findByEmail(email);
    if (existing) {
      throw new ConflictException('Email already in use');
    }
    const user = await this.userService.create(name, lastname, email, password);
    return this.login(user);
  }
}
