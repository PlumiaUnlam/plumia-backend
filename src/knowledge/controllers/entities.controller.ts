import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Request,
} from '@nestjs/common';
import { CreateEntityDto } from '../dto/create-entity.dto';
import { UpdateEntityDto } from '../dto/update-entity.dto';
import { EntityResponseDto } from '../dto/responses/entity-response.dto';
import { EntityType } from '../domain/entity-type';
import { KnowledgeService } from '../knowledge.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('knowledge/entities')
export class EntitiesController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  async listEntities(
    @Request() _req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<EntityResponseDto[]> {
    const entities = await this.knowledgeService.listEntities({
      projectId,
      ...(search === undefined ? {} : { search }),
      ...(type === undefined ? {} : { type: type as EntityType }),
      ...(limit === undefined ? {} : { limit: Number.parseInt(limit, 10) }),
    });
    return entities.map((entity) => EntityResponseDto.from(entity));
  }

  @Post()
  async createEntity(
    @Request() req: AuthenticatedRequest,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateEntityDto,
  ): Promise<EntityResponseDto> {
    const entity = await this.knowledgeService.createEntity(
      req.user.id,
      projectId,
      dto,
    );
    return EntityResponseDto.from(entity);
  }

  @Get(':id')
  async getEntityById(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntityResponseDto> {
    const entity = await this.knowledgeService.getEntityById(req.user.id, id);
    return EntityResponseDto.from(entity);
  }

  @Patch(':id')
  async updateEntity(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntityDto,
  ): Promise<EntityResponseDto> {
    const entity = await this.knowledgeService.updateEntity(
      req.user.id,
      id,
      dto,
    );
    return EntityResponseDto.from(entity);
  }

  @Delete(':id')
  async removeEntity(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntityResponseDto> {
    const entity = await this.knowledgeService.removeEntity(req.user.id, id);
    return EntityResponseDto.from(entity);
  }
}
