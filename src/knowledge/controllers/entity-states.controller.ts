import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { CreateEntityStateDto } from '../dto/create-entity-state.dto';
import { UpdateEntityStateDto } from '../dto/update-entity-state.dto';
import { EntityStateResponseDto } from '../dto/responses/entity-state-response.dto';
import { TemporalStateService } from '../services/temporal-state.service';

@Controller('knowledge')
export class EntityStatesController {
  constructor(private readonly states: TemporalStateService) {}

  @Get('entities/:entityId/states')
  list(
    @Request() req: AuthenticatedRequest,
    @Param('entityId', ParseUUIDPipe) entityId: string,
  ): Promise<EntityStateResponseDto[]> {
    return this.states.listStates(req.user.id, entityId);
  }

  @Post('entities/:entityId/states')
  create(
    @Request() req: AuthenticatedRequest,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @Body() dto: CreateEntityStateDto,
  ): Promise<EntityStateResponseDto> {
    return this.states.createState(req.user.id, entityId, dto);
  }

  @Patch('entity-states/:stateId')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('stateId', ParseUUIDPipe) stateId: string,
    @Body() dto: UpdateEntityStateDto,
  ): Promise<EntityStateResponseDto> {
    return this.states.updateState(req.user.id, stateId, dto);
  }

  @Delete('entity-states/:stateId')
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('stateId', ParseUUIDPipe) stateId: string,
  ): Promise<void> {
    await this.states.removeState(req.user.id, stateId);
  }
}
