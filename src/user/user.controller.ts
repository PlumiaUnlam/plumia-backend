import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Put,
  Request,
} from '@nestjs/common';
import { AiSettingsResponseDto } from './dto/ai-settings-response.dto';
import { UpdateGeminiApiKeyDto } from './dto/update-gemini-api-key.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserService, type UserEntity } from './user.service';
import { UserApiKeyService } from './user-api-key.service';

@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly userApiKeys: UserApiKeyService,
  ) {}

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

  @Get('me/ai-settings')
  getAiSettings(
    @Request() req: { user: { id: string } },
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.getGeminiSettings(req.user.id);
  }

  @Put('me/ai-settings/gemini')
  saveGeminiApiKey(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateGeminiApiKeyDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.saveGeminiKey(req.user.id, dto.apiKey.trim());
  }

  @Delete('me/ai-settings/gemini')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeGeminiApiKey(
    @Request() req: { user: { id: string } },
  ): Promise<void> {
    await this.userApiKeys.removeGeminiKey(req.user.id);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteMe(
    @Request() req: { user: { id: string; uid: string } },
  ): Promise<void> {
    return this.userService.deleteAccount(req.user.id, req.user.uid);
  }
}
