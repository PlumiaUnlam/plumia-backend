import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { EntityStateProposalOverrideDto } from '../dto/entity-state-proposal-override.dto';
import { EntityStateProposalResponseDto } from '../dto/responses/entity-state-proposal-response.dto';
import { EntityStateResponseDto } from '../dto/responses/entity-state-response.dto';
import { TemporalStateService } from '../services/temporal-state.service';

@Controller('v1')
export class EntityStateProposalsController {
  constructor(private readonly states: TemporalStateService) {}

  @Get('projects/:projectId/state-proposals')
  list(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EntityStateProposalResponseDto[]> {
    return this.states.listPendingProposals(req.user.id, projectId);
  }

  @Post('state-proposals/:proposalId/accept')
  accept(
    @Request() req: AuthenticatedRequest,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
    @Body() override?: EntityStateProposalOverrideDto,
  ): Promise<EntityStateResponseDto> {
    return this.states.acceptProposal(req.user.id, proposalId, override);
  }

  @Delete('state-proposals/:proposalId')
  async reject(
    @Request() req: AuthenticatedRequest,
    @Param('proposalId', ParseUUIDPipe) proposalId: string,
  ): Promise<void> {
    await this.states.rejectProposal(req.user.id, proposalId);
  }
}
