import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
//import { UserService } from '../../user/user.service';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    //private readonly userService: UserService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<{ id: string; email: string }> {
    if (!payload) {
      console.error('JWT payload is missing');
    }
    //const user = await this.userService.findById(payload.sub);
    //if (!user) {
    //  throw new UnauthorizedException();
    //}

    return Promise.resolve({
      id: '5427d530-246e-4c45-8f98-4c5747f4eddb',
      email: 'user@example.com',
    });
  }
}
