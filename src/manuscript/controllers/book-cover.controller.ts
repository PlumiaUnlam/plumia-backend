import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import {
  CreateBookCoverUploadDto,
  SetBookCoverDto,
} from '../dto/books/book-cover.dto';
import { BookCoverService } from '../services/book-cover.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('books/:id/cover')
export class BookCoverController {
  constructor(private readonly bookCoverService: BookCoverService) {}

  @Post('upload-url')
  @HttpCode(HttpStatus.OK)
  createUploadUrl(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateBookCoverUploadDto,
  ): Promise<{ presignedUrl: string; storageKey: string }> {
    return this.bookCoverService.createUploadUrl(
      req.user.id,
      id,
      dto.contentType,
    );
  }

  @Put()
  setCover(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetBookCoverDto,
  ): Promise<{ coverUrl: string }> {
    return this.bookCoverService.setCover(req.user.id, id, dto.storageKey);
  }

  @Get()
  getCover(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ coverUrl: string | null }> {
    return this.bookCoverService.getCover(req.user.id, id);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  removeCover(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.bookCoverService.removeCover(req.user.id, id);
  }
}
