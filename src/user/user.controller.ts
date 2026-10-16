import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Request,
} from '@nestjs/common';
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
    // Se piden solo los campos a mano: `req.user` trae además `uid`, que es un
    // detalle interno del guard y no forma parte de este contrato.
    return { id: req.user.id, email: req.user.email };
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

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(
    @Request() req: { user: { id: string; uid: string } },
  ): Promise<void> {
    return this.userService.deleteAccount(req.user.id, req.user.uid);
  }
}
