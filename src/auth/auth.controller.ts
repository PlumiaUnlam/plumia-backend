import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import type { User } from '@prisma/client';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{
    user: Omit<User, 'deletedAt'>;
  }> {
    const result = await this.authService.login(dto.idToken);
    const safeUser = Object.fromEntries(
      Object.entries(result).filter(([key]) => key !== 'deletedAt'),
    ) as Omit<User, 'deletedAt'>;
    return { user: safeUser };
  }
}
