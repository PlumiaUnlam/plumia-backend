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
import { StoryboardCardResponseDto } from '../dto/responses/storyboard-card-response.dto';
import { CreateStoryboardCardDto } from '../dto/storyboard/create-storyboard-card.dto';
import { UpdateStoryboardCardDto } from '../dto/storyboard/update-storyboard-card.dto';
import { StoryboardCardService } from '../services/storyboard-card.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class StoryboardCardsController {
  constructor(private readonly storyboardCardService: StoryboardCardService) {}

  @Get('projects/:projectId/storyboard-cards')
  async listCards(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<StoryboardCardResponseDto[]> {
    const cards = await this.storyboardCardService.listByProject(
      req.user.id,
      projectId,
    );
    return cards.map((card) => StoryboardCardResponseDto.from(card));
  }

  @Post('projects/:projectId/storyboard-cards')
  async createCard(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateStoryboardCardDto,
  ): Promise<StoryboardCardResponseDto> {
    const card = await this.storyboardCardService.create(
      req.user.id,
      projectId,
      dto,
    );
    return StoryboardCardResponseDto.from(card);
  }

  @Patch('storyboard-cards/:id')
  async updateCard(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryboardCardDto,
  ): Promise<StoryboardCardResponseDto> {
    const card = await this.storyboardCardService.update(req.user.id, id, dto);
    return StoryboardCardResponseDto.from(card);
  }

  @Delete('storyboard-cards/:id')
  @HttpCode(204)
  async removeCard(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.storyboardCardService.remove(req.user.id, id);
  }
}
