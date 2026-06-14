import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport';
import { Request } from 'express';
import { FirebaseAdminService } from '../firebase-admin.service';
import { AuthService } from '../auth.service';
import type * as admin from 'firebase-admin';

@Injectable()
export class FirebaseStrategy extends PassportStrategy(Strategy, 'firebase') {
  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly authService: AuthService,
  ) {
    super();
  }

  async validate(request: Request): Promise<{ id: string; email: string }> {
    const token = this.extractToken(request);
    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    let decoded: admin.auth.DecodedIdToken;
    try {
      decoded = await this.firebaseAdmin.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.authService.validateFirebaseUser(decoded);
    return { id: user.id, email: user.email };
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      return null;
    }
    const [scheme, token] = authHeader.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return null;
    }
    return token;
  }
}
