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
import { SaveEditorTextStyleDto } from '../dto/editor-text-styles/save-editor-text-style.dto';
import type { EditorTextStyleRecord } from '../ports/editor-text-style-repository.port';
import { EditorTextStylesService } from '../services/editor-text-styles.service';

@Controller('projects/:projectId/editor-styles')
export class EditorTextStylesController {
  constructor(private readonly stylesService: EditorTextStylesService) {}

  @Get()
  list(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<EditorTextStyleRecord[]> {
    return this.stylesService.list(req.user.id, projectId);
  }

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: SaveEditorTextStyleDto,
  ): Promise<EditorTextStyleRecord> {
    return this.stylesService.create(req.user.id, projectId, dto);
  }

  @Patch(':styleId')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('styleId', ParseUUIDPipe) styleId: string,
    @Body() dto: SaveEditorTextStyleDto,
  ): Promise<EditorTextStyleRecord> {
    return this.stylesService.update(req.user.id, projectId, styleId, dto);
  }

  @Delete(':styleId')
  async remove(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('styleId', ParseUUIDPipe) styleId: string,
  ): Promise<void> {
    await this.stylesService.remove(req.user.id, projectId, styleId);
  }
}
