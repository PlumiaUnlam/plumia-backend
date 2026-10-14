import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { TemporalStateService } from '../services/temporal-state.service';

@Controller('knowledge/projects')
export class TemporalViewController {
  constructor(private readonly states: TemporalStateService) {}

  @Get(':projectId/temporal-view')
  getView(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    return this.states.getTemporalView(req.user.id, projectId, sceneId);
  }
}
