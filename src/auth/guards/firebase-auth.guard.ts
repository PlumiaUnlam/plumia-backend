import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { AuthService } from '../auth.service';
import { FirebaseAdminService } from '../firebase-admin.service';

type RequestWithUser = Request & {
  user?: {
    id: string;
    uid: string;
    email: string;
  };
};

@Injectable()
export class FirebaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing authorization token');
    }

    const user = await this.authService.login(token);

    const decoded = await this.firebaseAdmin.verifyToken(token);
    if (decoded.email_verified !== true) {
      throw new ForbiddenException('Email verification required');
    }

    // `id` es el id de nuestra fila y `uid` el del token recién verificado: son
    // lo mismo en el caso normal, pero no siempre (validateFirebaseUser cae al
    // fallback por email cuando findById no matchea). Quien necesite tocar
    // Firebase tiene que usar `uid`; usar `id` ahí borraría el identificador
    // equivocado y dejaría la identidad viva en silencio.
    request.user = { id: user.id, uid: decoded.uid, email: user.email };

    return true;
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
