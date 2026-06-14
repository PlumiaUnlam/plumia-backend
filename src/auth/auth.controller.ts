import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import type { User } from '@prisma/client';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto): Promise<{
    user: Omit<User, 'deletedAt'>;
  }> {
    const user = await this.authService.login(dto.idToken);
    const { deletedAt: _, ...safeUser } = user;
    return { user: safeUser };
  }
}
