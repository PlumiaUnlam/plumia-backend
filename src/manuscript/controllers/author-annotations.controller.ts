import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './authenticated-request';
import { CreateAuthorAnnotationDto } from '../dto/create-author-annotation.dto';
import { UpdateAuthorAnnotationDto } from '../dto/update-author-annotation.dto';
import { AuthorAnnotationsService } from '../services/author-annotations.service';

@Controller()
export class AuthorAnnotationsController {
  constructor(private readonly annotations: AuthorAnnotationsService) {}

  @Get('scenes/:sceneId/annotations')
  list(
    @Request() req: AuthenticatedRequest,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ): ReturnType<AuthorAnnotationsService['list']> {
    return this.annotations.list(req.user.id, sceneId);
  }

  @Post('scenes/:sceneId/annotations')
  create(
    @Request() req: AuthenticatedRequest,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: CreateAuthorAnnotationDto,
  ): ReturnType<AuthorAnnotationsService['create']> {
    return this.annotations.create(req.user.id, sceneId, dto);
  }

  @Patch('scenes/:sceneId/annotations/:annotationId')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
    @Body() dto: UpdateAuthorAnnotationDto,
  ): ReturnType<AuthorAnnotationsService['update']> {
    return this.annotations.update(req.user.id, sceneId, annotationId, dto);
  }

  @Delete('scenes/:sceneId/annotations/:annotationId')
  @HttpCode(204)
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Param('annotationId', ParseUUIDPipe) annotationId: string,
  ): Promise<void> {
    await this.annotations.remove(req.user.id, sceneId, annotationId);
  }
}
