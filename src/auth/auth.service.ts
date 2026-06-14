import { Injectable, UnauthorizedException } from '@nestjs/common';
import { type User } from '@prisma/client';
import { UserService } from '../user/user.service';
import { FirebaseAdminService } from './firebase-admin.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  async login(idToken: string): Promise<User> {
    let decoded;
    try {
      decoded = await this.firebaseAdmin.verifyToken(idToken);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    return this.validateFirebaseUser(decoded);
  }

  async validateFirebaseUser(firebaseUser: {
    uid: string;
    email?: string;
    name?: string;
    picture?: string;
  }): Promise<User> {
    const existing = await this.userService.findById(firebaseUser.uid);
    if (existing) {
      return existing;
    }

    return this.userService.createFromFirebase({
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? '',
      name: firebaseUser.name ?? firebaseUser.email?.split('@')[0] ?? 'User',
      avatarUrl: firebaseUser.picture ?? null,
    });
  }
}
