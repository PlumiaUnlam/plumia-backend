import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../manuscript/controllers/authenticated-request';
import { UpdateKnowledgeReviewSettingsDto } from './dto/update-knowledge-review-settings.dto';
import { ProjectKnowledgeReviewService } from './project-knowledge-review.service';

@Controller('projects/:projectId')
export class ProjectKnowledgeReviewController {
  constructor(private readonly service: ProjectKnowledgeReviewService) {}

  @Get('knowledge-review-settings')
  getSettings(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.getSettings(req.user.id, projectId);
  }

  @Put('knowledge-review-settings')
  updateSettings(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: UpdateKnowledgeReviewSettingsDto,
  ) {
    return this.service.updateSettings(req.user.id, projectId, dto);
  }

  @Get('analysis-preview')
  previewAnalysis(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.previewAnalysis(req.user.id, projectId);
  }

  @Post('analyze-changes')
  startAnalysis(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.service.startAnalysis(req.user.id, projectId);
  }

  @Get('analysis-runs/:runId')
  getRun(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.getRun(req.user.id, projectId, runId);
  }

  @Post('analysis-runs/:runId/retry-failed')
  retryFailed(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('runId', ParseUUIDPipe) runId: string,
  ) {
    return this.service.retryFailed(req.user.id, projectId, runId);
  }
}
