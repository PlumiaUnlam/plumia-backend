import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
} from '@nestjs/common';
import { EntityProposalService } from '../services/entity-proposal.service';
import { EntityProposalResponseDto } from '../dto/responses/entity-proposal-response.dto';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import { AcceptEntityProposalDto } from '../dto/accept-entity-proposal.dto';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('v1')
export class EntityProposalsController {
  constructor(private readonly entityProposalService: EntityProposalService) {}

  @Get('projects/:projectId/proposals')
  async listProjectProposals(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EntityProposalResponseDto[]> {
    return this.entityProposalService.listPendingByProject(req.user.id, projectId);
  }

  @Post('proposals/:id/accept')
  async acceptProposal(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AcceptEntityProposalDto,
  ): Promise<EntityResponseDto> {
    return this.entityProposalService.acceptProposal(req.user.id, id, body);
  }

  @Post('proposals/:id/reject')
  async rejectProposal(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntityProposalResponseDto> {
    return this.entityProposalService.rejectProposal(req.user.id, id);
  }
}
