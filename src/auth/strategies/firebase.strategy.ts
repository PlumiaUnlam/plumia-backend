import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-http-bearer';
import { FirebaseAdminService } from '../firebase-admin.service';
import { AuthService } from '../auth.service';

@Injectable()
export class FirebaseStrategy extends PassportStrategy(Strategy, 'firebase') {
  constructor(
    private readonly firebaseAdmin: FirebaseAdminService,
    private readonly authService: AuthService,
  ) {
    super();
  }

  async validate(token: string): Promise<{ id: string; email: string }> {
    let decoded;
    try {
      decoded = await this.firebaseAdmin.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const user = await this.authService.validateFirebaseUser(decoded);
    return { id: user.id, email: user.email };
  }
}
