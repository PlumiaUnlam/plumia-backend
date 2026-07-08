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
import {
  StoryboardArcResponseDto,
  StoryboardMatrixNoteResponseDto,
} from '../dto/responses/storyboard-matrix-response.dto';
import { CreateMatrixNoteDto } from '../dto/storyboard-matrix/create-matrix-note.dto';
import { CreateStoryboardArcDto } from '../dto/storyboard-matrix/create-storyboard-arc.dto';
import { UpdateMatrixNoteDto } from '../dto/storyboard-matrix/update-matrix-note.dto';
import { StoryboardMatrixService } from '../services/storyboard-matrix.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class StoryboardMatrixController {
  constructor(
    private readonly storyboardMatrixService: StoryboardMatrixService,
  ) {}

  @Get('projects/:projectId/storyboard-arcs')
  async listArcs(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<StoryboardArcResponseDto[]> {
    const arcs = await this.storyboardMatrixService.listArcs(
      req.user.id,
      projectId,
    );
    return arcs.map((arc) => StoryboardArcResponseDto.from(arc));
  }

  @Post('projects/:projectId/storyboard-arcs')
  async createArc(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateStoryboardArcDto,
  ): Promise<StoryboardArcResponseDto> {
    const arc = await this.storyboardMatrixService.createArc(
      req.user.id,
      projectId,
      dto,
    );
    return StoryboardArcResponseDto.from(arc);
  }

  @Delete('storyboard-arcs/:id')
  @HttpCode(204)
  async removeArc(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.storyboardMatrixService.removeArc(req.user.id, id);
  }

  @Post('storyboard-arcs/:arcId/notes')
  async createNote(
    @Request() req: AuthenticatedRequest,
    @Param('arcId', ParseUUIDPipe) arcId: string,
    @Body() dto: CreateMatrixNoteDto,
  ): Promise<StoryboardMatrixNoteResponseDto> {
    const note = await this.storyboardMatrixService.createNote(
      req.user.id,
      arcId,
      dto,
    );
    return StoryboardMatrixNoteResponseDto.from(note);
  }

  @Patch('storyboard-matrix-notes/:id')
  async updateNote(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMatrixNoteDto,
  ): Promise<StoryboardMatrixNoteResponseDto> {
    const note = await this.storyboardMatrixService.updateNote(
      req.user.id,
      id,
      dto,
    );
    return StoryboardMatrixNoteResponseDto.from(note);
  }

  @Delete('storyboard-matrix-notes/:id')
  @HttpCode(204)
  async removeNote(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.storyboardMatrixService.removeNote(req.user.id, id);
  }
}
