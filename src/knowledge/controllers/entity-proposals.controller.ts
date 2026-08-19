import {
  Controller,
  Body,
  Get,
  Param,
  ParseUUIDPipe,
  Delete,
  Post,
  Request,
} from '@nestjs/common';
import { EntityProposalService } from '../services/entity-proposal.service';
import { EntityProposalResponseDto } from '../dto/responses/entity-proposal-response.dto';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import type { AuthenticatedRequest } from './authenticated-request';
import { EntityProposalOverrideDto } from '../dto/entity-proposal-override.dto';

@Controller('v1')
export class EntityProposalsController {
  constructor(private readonly entityProposalService: EntityProposalService) {}

  @Get('projects/:projectId/proposals')
  async listProjectProposals(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EntityProposalResponseDto[]> {
    return this.entityProposalService.listPendingByProject(
      req.user.id,
      projectId,
    );
  }

  @Post('proposals/:id/accept')
  async acceptProposal(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() override?: EntityProposalOverrideDto,
  ): Promise<EntityResponseDto> {
    return this.entityProposalService.acceptProposal(req.user.id, id, override);
  }

  @Delete('proposals/:id')
  async rejectProposal(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.entityProposalService.rejectProposal(req.user.id, id);
  }
}
