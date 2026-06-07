import { Body, Controller, Post, Request, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { LocalAuthGuard } from './guards/local-auth.guard';

@Public()
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(LocalAuthGuard)
  @Post('login')
  login(@Request() req: { user: { id: string; email: string } }) {
    return this.authService.login(req.user);
  }

  @Post('register')
  register(@Body() dto: LoginDto) {
    return this.authService.register(dto.email, dto.password);
  }
}
