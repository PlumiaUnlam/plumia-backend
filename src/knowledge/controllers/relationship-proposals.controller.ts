import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
} from '@nestjs/common';
import { RelationshipProposalService } from '../services/relationship-proposal.service';
import { RelationshipProposalResponseDto } from '../dto/responses/relationship-proposal-response.dto';
import { RelationshipResponseDto } from '../dto/responses/relationship-response.dto';
import type { AuthenticatedRequest } from './authenticated-request';
import { Body } from '@nestjs/common';
import { RelationshipProposalOverrideDto } from '../dto/relationship-proposal-override.dto';

@Controller('v1')
export class RelationshipProposalsController {
  constructor(private readonly service: RelationshipProposalService) {}

  @Get('projects/:projectId/relationship-proposals')
  list(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<RelationshipProposalResponseDto[]> {
    return this.service.listPendingByProject(req.user.id, projectId);
  }

  @Post('relationship-proposals/:id/accept')
  accept(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() override?: RelationshipProposalOverrideDto,
  ): Promise<RelationshipResponseDto> {
    return this.service.acceptProposal(req.user.id, id, override);
  }

  @Delete('relationship-proposals/:id')
  async reject(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.rejectProposal(req.user.id, id);
  }
}
