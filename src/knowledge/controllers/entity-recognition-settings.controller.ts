import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import {
  ProjectEntityRecognitionSettingsResponseDto,
  UpdateProjectEntityRecognitionDto,
} from '../dto/entity-recognition-settings.dto';
import { EntityRecognitionSettingsService } from '../services/entity-recognition-settings.service';

@Controller('projects')
export class EntityRecognitionSettingsController {
  constructor(private readonly settings: EntityRecognitionSettingsService) {}

  @Get(':projectId/entity-recognition-settings')
  get(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ProjectEntityRecognitionSettingsResponseDto> {
    return this.settings.getProjectSettings(req.user.id, projectId);
  }

  @Put(':projectId/entity-recognition-settings')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateProjectEntityRecognitionDto,
  ): Promise<ProjectEntityRecognitionSettingsResponseDto> {
    return this.settings.updateProjectSettings(
      req.user.id,
      projectId,
      dto.importantEntityNames,
      dto.ignoredEntityNames,
    );
  }
}
