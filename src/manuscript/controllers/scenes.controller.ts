import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { CreateSceneDto } from '../dto/scenes/create-scene.dto';
import { PatchSceneDto } from '../dto/scenes/patch-scene.dto';
import { SaveSceneResultDto } from '../dto/responses/save-scene-result.dto';
import { SceneResponseDto } from '../dto/responses/scene-response.dto';
import { SceneService } from '../services/scene.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class ScenesController {
  constructor(private readonly sceneService: SceneService) {}

  @Post('chapters/:chapterId/scenes')
  async createScene(
    @Request() req: AuthenticatedRequest,
    @Param('chapterId', ParseUUIDPipe) chapterId: string,
    @Body() dto: CreateSceneDto,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.create(req.user.id, chapterId, dto);
    return SceneResponseDto.from(scene);
  }

  @Get('scenes/:id')
  async getSceneById(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.getById(req.user.id, id);
    return SceneResponseDto.from(scene);
  }

  @Patch('scenes/:id')
  async updateScene(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchSceneDto,
  ): Promise<SceneResponseDto> {
    if (dto.content !== undefined) {
      const result = await this.sceneService.updateContent(req.user.id, id, {
        content: dto.content,
        ...(dto.wordCount !== undefined ? { wordCount: dto.wordCount } : {}),
      });
      return SaveSceneResultDto.fromResult(result);
    }

    const scene = await this.sceneService.update(req.user.id, id, dto);
    return SceneResponseDto.from(scene);
  }

  @Delete('scenes/:id')
  @HttpCode(204)
  async removeScene(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.sceneService.remove(req.user.id, id);
  }
}
