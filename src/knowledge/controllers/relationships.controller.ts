import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { CreateRelationshipDto } from '../dto/create-relationship.dto';
import { RelationshipResponseDto } from '../dto/responses/relationship-response.dto';
import { UpdateRelationshipDto } from '../dto/update-relationship.dto';
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

  @Patch(':id')
  async updateRelationship(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateRelationshipDto,
  ): Promise<RelationshipResponseDto> {
    const relationship = await this.knowledgeService.updateRelationship(
      req.user.id,
      id,
      dto,
    );
    return RelationshipResponseDto.from(relationship);
  }

  @Delete(':id')
  async removeRelationship(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RelationshipResponseDto> {
    const relationship = await this.knowledgeService.removeRelationship(
      req.user.id,
      id,
    );
    return RelationshipResponseDto.from(relationship);
  }
}
