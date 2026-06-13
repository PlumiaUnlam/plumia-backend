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
import type { AuthenticatedRequest } from '../../manuscript/controllers/authenticated-request';
import { CreateEntityDto } from '../dto/entities/create-entity.dto';
import { ListEntitiesQueryDto } from '../dto/entities/list-entities-query.dto';
import { UpdateEntityDto } from '../dto/entities/update-entity.dto';
import {
  EntityDetailResponseDto,
  EntityResponseDto,
} from '../dto/responses/entity-response.dto';
import { EntityService } from '../services/entity.service';

@Controller()
export class EntitiesController {
  constructor(private readonly entityService: EntityService) {}

  @Get('projects/:projectId/entities')
  async listEntities(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: ListEntitiesQueryDto,
  ): Promise<EntityResponseDto[]> {
    const entities = await this.entityService.list(
      req.user.id,
      projectId,
      query,
    );
    return entities.map((entity) => EntityResponseDto.from(entity));
  }

  @Post('projects/:projectId/entities')
  async createEntity(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateEntityDto,
  ): Promise<EntityResponseDto> {
    const entity = await this.entityService.create(req.user.id, projectId, dto);
    return EntityResponseDto.from(entity);
  }

  @Get('entities/:id')
  async getEntityById(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntityDetailResponseDto> {
    const entity = await this.entityService.getById(req.user.id, id);
    return EntityDetailResponseDto.from(entity);
  }

  @Patch('entities/:id')
  async updateEntity(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEntityDto,
  ): Promise<EntityResponseDto> {
    const entity = await this.entityService.update(req.user.id, id, dto);
    return EntityResponseDto.from(entity);
  }

  @Delete('entities/:id')
  async removeEntity(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EntityResponseDto> {
    const entity = await this.entityService.remove(req.user.id, id);
    return EntityResponseDto.from(entity);
  }
}
