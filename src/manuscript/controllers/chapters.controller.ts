import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Request,
} from '@nestjs/common';
import { CreateChapterDto } from '../dto/chapters/create-chapter.dto';
import { UpdateChapterDto } from '../dto/chapters/update-chapter.dto';
import { ChapterResponseDto } from '../dto/responses/chapter-response.dto';
import { ChapterService } from '../services/chapter.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class ChaptersController {
  constructor(private readonly chapterService: ChapterService) {}

  @Post('books/:bookId/chapters')
  async createChapter(
    @Request() req: AuthenticatedRequest,
    @Param('bookId') bookId: string,
    @Body() dto: CreateChapterDto,
  ): Promise<ChapterResponseDto> {
    const chapter = await this.chapterService.create(req.user.id, bookId, dto);
    return ChapterResponseDto.from(chapter);
  }

  @Get('chapters/:id')
  async getChapterById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ChapterResponseDto> {
    const chapter = await this.chapterService.getById(req.user.id, id);
    return ChapterResponseDto.from(chapter);
  }

  @Patch('chapters/:id')
  async updateChapter(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateChapterDto,
  ): Promise<ChapterResponseDto> {
    const chapter = await this.chapterService.update(req.user.id, id, dto);
    return ChapterResponseDto.from(chapter);
  }

  @Delete('chapters/:id')
  async removeChapter(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ChapterResponseDto> {
    const chapter = await this.chapterService.remove(req.user.id, id);
    return ChapterResponseDto.from(chapter);
  }
}
