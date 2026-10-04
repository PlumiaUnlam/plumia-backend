import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseEnumPipe,
  ParseIntPipe,
  ParseUUIDPipe,
  Put,
  Query,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../manuscript/controllers/authenticated-request';
import { AnalyticsService } from './analytics.service';
import { UpsertWritingGoalDto } from './dto/upsert-writing-goal.dto';
import { WritingGoalType } from './domain/writing-goal-type';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('projects/:projectId/dashboard')
  getDashboard(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('timezoneOffsetMinutes', new DefaultValuePipe(0), ParseIntPipe)
    timezoneOffsetMinutes: number,
  ): ReturnType<AnalyticsService['getDashboard']> {
    return this.analyticsService.getDashboard(
      req.user.id,
      projectId,
      timezoneOffsetMinutes,
    );
  }

  @Put('projects/:projectId/goals/:goalType')
  upsertGoal(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('goalType', new ParseEnumPipe(WritingGoalType))
    goalType: WritingGoalType,
    @Body() dto: UpsertWritingGoalDto,
  ): ReturnType<AnalyticsService['upsertGoal']> {
    return this.analyticsService.upsertGoal(
      req.user.id,
      projectId,
      goalType,
      dto,
    );
  }
}
