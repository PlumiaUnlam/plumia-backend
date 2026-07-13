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
import { CreateSceneVersionDto } from '../dto/scenes/create-scene-version.dto';
import { PatchSceneDto } from '../dto/scenes/patch-scene.dto';
import { UpdateSceneVersionDto } from '../dto/scenes/update-scene-version.dto';
import { SaveSceneResultDto } from '../dto/responses/save-scene-result.dto';
import { SceneResponseDto } from '../dto/responses/scene-response.dto';
import {
  SaveSceneVersionResultDto,
  SceneVersionResponseDto,
  SceneVersionSummaryResponseDto,
} from '../dto/responses/scene-version-response.dto';
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

  @Get('scenes/:id/versions')
  async listSceneVersions(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SceneVersionSummaryResponseDto[]> {
    const versions = await this.sceneService.listVersions(req.user.id, id);
    return versions.map((version) =>
      SceneVersionSummaryResponseDto.from(version),
    );
  }

  @Post('scenes/:id/versions')
  async createSceneVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateSceneVersionDto,
  ): Promise<SceneVersionResponseDto> {
    const version = await this.sceneService.createVersion(req.user.id, id, dto);
    return SceneVersionResponseDto.from(version);
  }

  @Get('scenes/:id/versions/:versionId')
  async getSceneVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<SceneVersionResponseDto> {
    const version = await this.sceneService.getVersion(
      req.user.id,
      id,
      versionId,
    );
    return SceneVersionResponseDto.from(version);
  }

  @Patch('scenes/:id/versions/:versionId')
  async updateSceneVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: UpdateSceneVersionDto,
  ): Promise<SaveSceneVersionResultDto | SceneVersionResponseDto> {
    if (dto.content !== undefined) {
      const result = await this.sceneService.updateVersionContent(
        req.user.id,
        id,
        versionId,
        {
          content: dto.content,
          ...(dto.wordCount !== undefined ? { wordCount: dto.wordCount } : {}),
        },
      );
      return SaveSceneVersionResultDto.fromResult(result);
    }

    const version = await this.sceneService.updateVersion(
      req.user.id,
      id,
      versionId,
      dto,
    );
    return SceneVersionResponseDto.from(version);
  }

  @Post('scenes/:id/versions/:versionId/restore')
  async restoreSceneVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<SaveSceneResultDto> {
    const result = await this.sceneService.restoreVersion(
      req.user.id,
      id,
      versionId,
    );
    return SaveSceneResultDto.fromResult(result);
  }

  @Delete('scenes/:id/versions/:versionId')
  @HttpCode(204)
  async removeSceneVersion(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
  ): Promise<void> {
    await this.sceneService.removeVersion(req.user.id, id, versionId);
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
