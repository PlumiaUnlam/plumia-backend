import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../manuscript/controllers/authenticated-request';
import { UpdateExportSettingsDto } from './dto/update-export-settings.dto';
import { ExportSettingsResponseDto } from './dto/export-settings-response.dto';
import { ExportSettingsService } from './export-settings.service';

@Controller('projects/:projectId/export-settings')
export class ExportSettingsController {
  constructor(private readonly exportSettingsService: ExportSettingsService) {}

  @Get()
  get(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ExportSettingsResponseDto> {
    return this.exportSettingsService.getSettings(req.user.id, projectId);
  }

  @Put()
  update(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateExportSettingsDto,
  ): Promise<ExportSettingsResponseDto> {
    return this.exportSettingsService.upsertSettings(
      req.user.id,
      projectId,
      dto,
    );
  }
}
