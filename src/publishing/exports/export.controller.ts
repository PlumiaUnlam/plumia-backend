import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../../manuscript/controllers/authenticated-request';
import { CreateExportDto } from './dto/create-export.dto';
import { ExportJobResponseDto } from './dto/export-job-response.dto';
import { ExportService } from './export.service';

@Controller('projects/:projectId/exports')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateExportDto,
  ): Promise<ExportJobResponseDto> {
    return this.exportService.requestExport(req.user.id, projectId, dto.format);
  }

  @Get(':exportId')
  getStatus(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('exportId', ParseUUIDPipe) exportId: string,
  ): Promise<ExportJobResponseDto> {
    return this.exportService.getExportStatus(req.user.id, projectId, exportId);
  }
}
