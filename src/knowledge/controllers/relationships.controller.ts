import {
  Body,
  Controller,
  Get,
  NotFoundException,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { CreateRelationshipDto } from '../dto/create-relationship.dto';
import { RelationshipResponseDto } from '../dto/responses/relationship-response.dto';
import { KnowledgeService } from '../knowledge.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('knowledge/relationships')
export class RelationshipsController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async listRelationships(
    @Request() req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<RelationshipResponseDto[]> {
    const relationships = await this.knowledgeService.listRelationships(
      req.user.id,
      projectId,
    );
    return relationships.map((relationship) =>
      RelationshipResponseDto.from(relationship),
    );
  }

  @Post()
  async createRelationship(
    @Request() req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateRelationshipDto,
  ): Promise<RelationshipResponseDto> {
    const relationship = await this.knowledgeService.createRelationship(
      req.user.id,
      projectId,
      dto,
    );

    if (!relationship) {
      throw new NotFoundException('Project or entity not found');
    }

    return RelationshipResponseDto.from(relationship);
  }
}
