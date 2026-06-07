import { Controller, Get, Request } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get('me')
  getMe(@Request() req: { user: { id: string; email: string } }) {
    return req.user;
  }
}
