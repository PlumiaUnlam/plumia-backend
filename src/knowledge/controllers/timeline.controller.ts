import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { TimelineImpact } from '../domain/timeline-impact';
import { CreateTimelineEventDto } from '../dto/timeline/create-timeline-event.dto';
import { MoveTimelineEventDto } from '../dto/timeline/move-timeline-event.dto';
import { UpdateTimelineEventDto } from '../dto/timeline/update-timeline-event.dto';
import { TimelineEventResponseDto } from '../dto/responses/timeline-event-response.dto';
import { KnowledgeService } from '../knowledge.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('knowledge/timeline')
export class TimelineController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async listTimelineEvents(
    @Request() req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('entityId', new ParseUUIDPipe({ optional: true })) entityId?: string,
    @Query('storyboardArcId', new ParseUUIDPipe({ optional: true }))
    storyboardArcId?: string,
    @Query('impact', new ParseEnumPipe(TimelineImpact, { optional: true }))
    impact?: TimelineImpact,
  ): Promise<TimelineEventResponseDto[]> {
    const events = await this.knowledgeService.listTimelineEvents(req.user.id, {
      projectId,
      ...(entityId === undefined ? {} : { entityId }),
      ...(storyboardArcId === undefined ? {} : { storyboardArcId }),
      ...(impact === undefined ? {} : { impact }),
    });
    return events.map((event) => TimelineEventResponseDto.from(event));
  }

  @Post()
  async createTimelineEvent(
    @Request() req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateTimelineEventDto,
  ): Promise<TimelineEventResponseDto> {
    const event = await this.knowledgeService.createTimelineEvent(
      req.user.id,
      projectId,
      dto,
    );
    return TimelineEventResponseDto.from(event);
  }

  @Patch(':id')
  async updateTimelineEvent(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTimelineEventDto,
  ): Promise<TimelineEventResponseDto> {
    const event = await this.knowledgeService.updateTimelineEvent(
      req.user.id,
      id,
      dto,
    );
    return TimelineEventResponseDto.from(event);
  }

  @Post(':id/move')
  @HttpCode(200)
  async moveTimelineEvent(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoveTimelineEventDto,
  ): Promise<TimelineEventResponseDto> {
    const event = await this.knowledgeService.moveTimelineEvent(
      req.user.id,
      id,
      dto,
    );
    return TimelineEventResponseDto.from(event);
  }

  @Delete(':id')
  async removeTimelineEvent(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TimelineEventResponseDto> {
    const event = await this.knowledgeService.removeTimelineEvent(
      req.user.id,
      id,
    );
    return TimelineEventResponseDto.from(event);
  }
}
