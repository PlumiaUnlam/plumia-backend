import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import { CreateSceneDto } from '../dto/scenes/create-scene.dto';
import { UpdateSceneContentDto } from '../dto/scenes/update-scene-content.dto';
import { UpdateSceneMetadataDto } from '../dto/scenes/update-scene-metadata.dto';
import { SceneResponseDto } from '../dto/responses/scene-response.dto';
import { SceneService } from '../services/scene.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class ScenesController {
  constructor(private readonly sceneService: SceneService) {}

  @Post('chapters/:chapterId/scenes')
  async createScene(
    @Request() req: AuthenticatedRequest,
    @Param('chapterId') chapterId: string,
    @Body() dto: CreateSceneDto,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.create(req.user.id, chapterId, dto);
    return SceneResponseDto.from(scene);
  }

  @Get('scenes/:id')
  async getSceneById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.getById(req.user.id, id);
    return SceneResponseDto.from(scene);
  }

  @Patch('scenes/:id')
  async updateScene(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSceneMetadataDto,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.update(req.user.id, id, dto);
    return SceneResponseDto.from(scene);
  }

  @Put('scenes/:id/content')
  async updateSceneContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSceneContentDto,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.updateContent(req.user.id, id, dto);
    return SceneResponseDto.from(scene);
  }

  @Delete('scenes/:id')
  async removeScene(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SceneResponseDto> {
    const scene = await this.sceneService.remove(req.user.id, id);
    return SceneResponseDto.from(scene);
  }
}
