import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { SUMMARY_SCOPE } from '../domain/summary-scope';
import { SummaryJobResponseDto } from '../dto/summary-job-response.dto';
import { SummaryResponseDto } from '../dto/summary-response.dto';
import { UpdateSummaryDto } from '../dto/update-summary.dto';
import { SummaryService } from '../summary.service';
import type { AuthenticatedRequest } from '../../manuscript/controllers/authenticated-request';

@Controller()
export class SummaryController {
  constructor(private readonly summaryService: SummaryService) {}

  @Get('scenes/:id/summary')
  async getSceneSummary(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SummaryResponseDto> {
    return SummaryResponseDto.from(
      await this.summaryService.getSummary(
        req.user.id,
        SUMMARY_SCOPE.SCENE,
        id,
      ),
    );
  }

  @Post('scenes/:id/summary/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateSceneSummary(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SummaryJobResponseDto> {
    return SummaryJobResponseDto.from(
      await this.summaryService.requestGeneration(
        req.user.id,
        SUMMARY_SCOPE.SCENE,
        id,
      ),
    );
  }

  @Get('chapters/:id/summary')
  async getChapterSummary(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SummaryResponseDto> {
    return SummaryResponseDto.from(
      await this.summaryService.getSummary(
        req.user.id,
        SUMMARY_SCOPE.CHAPTER,
        id,
      ),
    );
  }

  @Post('chapters/:id/summary/generate')
  @HttpCode(HttpStatus.ACCEPTED)
  async generateChapterSummary(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SummaryJobResponseDto> {
    return SummaryJobResponseDto.from(
      await this.summaryService.requestGeneration(
        req.user.id,
        SUMMARY_SCOPE.CHAPTER,
        id,
      ),
    );
  }

  @Get('summary-jobs/:id')
  async getJob(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SummaryJobResponseDto> {
    return SummaryJobResponseDto.from(
      await this.summaryService.getJob(req.user.id, id),
    );
  }

  @Patch('summaries/:id')
  async updateSummary(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSummaryDto,
  ): Promise<SummaryResponseDto> {
    return SummaryResponseDto.from(
      await this.summaryService.updateManual(req.user.id, id, dto.content),
    );
  }
}
