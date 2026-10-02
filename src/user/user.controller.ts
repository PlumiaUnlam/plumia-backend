import { Body, Controller, Get, Patch, Request } from '@nestjs/common';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserService, type UserEntity } from './user.service';

@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  getMe(@Request() req: { user: { id: string; email: string } }): {
    id: string;
    email: string;
  } {
    return req.user;
  }

  @Patch('me')
  updateMe(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateProfileDto,
  ): Promise<UserEntity> {
    return this.userService.updateProfile(req.user.id, {
      displayName: dto.displayName.trim(),
      avatarUrl: dto.avatarUrl ?? null,
    });
  }
}
