import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { type User } from '@prisma/client';
import { UserService } from '../user/user.service';
import { FirebaseAdminService } from './firebase-admin.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly userService: UserService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  async login(idToken: string): Promise<User> {
    let decoded;
    try {
      decoded = await this.firebaseAdmin.verifyToken(idToken);
    } catch (error) {
      const code = firebaseErrorCode(error);
      this.logger.warn(`Firebase ID token rejected${code ? ` (${code})` : ''}`);
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

    if (firebaseUser.email) {
      const existingByEmail = await this.userService.findByEmail(
        firebaseUser.email,
      );
      if (existingByEmail) {
        return existingByEmail;
      }
    }

    return this.userService.createFromFirebase({
      uid: firebaseUser.uid,
      email: firebaseUser.email ?? '',
      name: firebaseUser.name ?? firebaseUser.email?.split('@')[0] ?? 'User',
      avatarUrl: firebaseUser.picture ?? null,
    });
  }
}

function firebaseErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}
