import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Put,
  Request,
} from '@nestjs/common';
import { AiSettingsResponseDto } from './dto/ai-settings-response.dto';
import { UpdateGeminiApiKeyDto } from './dto/update-gemini-api-key.dto';
import { UpdateAiProviderSettingsDto } from './dto/update-ai-provider-settings.dto';
import { UpdateProviderApiKeyDto } from './dto/update-provider-api-key.dto';
import { UpdateAutoAnalysisDto } from './dto/update-auto-analysis.dto';
import { UpdateEntityRecognitionDto } from './dto/update-entity-recognition.dto';
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
    return this.userApiKeys.getAiSettings(req.user.id);
  }

  @Put('me/ai-settings/provider')
  updateAiProviderSettings(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateAiProviderSettingsDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.updateAiProviderSettings(req.user.id, dto);
  }

  @Put('me/ai-settings/providers/:provider/api-key')
  saveProviderApiKey(
    @Request() req: { user: { id: string } },
    @Param('provider') provider: string,
    @Body() dto: UpdateProviderApiKeyDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.saveProviderKey(req.user.id, provider, dto.apiKey);
  }

  @Delete('me/ai-settings/providers/:provider/api-key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeProviderApiKey(
    @Request() req: { user: { id: string } },
    @Param('provider') provider: string,
  ): Promise<void> {
    await this.userApiKeys.removeProviderKey(req.user.id, provider);
  }

  @Put('me/ai-settings/gemini')
  saveGeminiApiKey(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateGeminiApiKeyDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.saveGeminiKey(req.user.id, dto.apiKey.trim());
  }

  @Put('me/ai-settings/auto-analysis')
  updateAutoAnalysis(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateAutoAnalysisDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.updateAutoAnalyzeOnAutosave(
      req.user.id,
      dto.enabled,
    );
  }

  @Put('me/ai-settings/entity-recognition')
  updateEntityRecognition(
    @Request() req: { user: { id: string } },
    @Body() dto: UpdateEntityRecognitionDto,
  ): Promise<AiSettingsResponseDto> {
    return this.userApiKeys.updateEntityRecognitionThresholds(
      req.user.id,
      dto.thresholds,
    );
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
