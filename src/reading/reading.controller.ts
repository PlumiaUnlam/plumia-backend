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
import type { AuthenticatedRequest } from '../manuscript/controllers/authenticated-request';
import { AcceptShareDto } from './dto/accept-share.dto';
import { CreateReaderCommentDto } from './dto/create-reader-comment.dto';
import { CreateShareDto } from './dto/create-share.dto';
import { SharedStorageUrlDto } from './dto/shared-storage-url.dto';
import { UpdateReaderCommentDto } from './dto/update-reader-comment.dto';
import { UpdateShareDto } from './dto/update-share.dto';
import { ReadingService } from './reading.service';
import type {
  CreatedShare,
  ReaderCommentView,
  ShareSummary,
  SharedManuscriptView,
} from './reading.types';

@Controller()
export class ReadingController {
  constructor(private readonly readingService: ReadingService) {}

  @Post('books/:bookId/shares')
  createShare(
    @Request() req: AuthenticatedRequest,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Body() dto: CreateShareDto,
  ): Promise<CreatedShare> {
    return this.readingService.createShare(req.user.id, bookId, dto);
  }

  @Get('books/:bookId/shares')
  listShares(
    @Request() req: AuthenticatedRequest,
    @Param('bookId', ParseUUIDPipe) bookId: string,
  ): Promise<ShareSummary[]> {
    return this.readingService.listBookShares(req.user.id, bookId);
  }

  @Patch('books/:bookId/shares/:shareId')
  updateShare(
    @Request() req: AuthenticatedRequest,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: UpdateShareDto,
  ): Promise<ShareSummary> {
    return this.readingService.updateShare(req.user.id, bookId, shareId, dto);
  }

  @Delete('books/:bookId/shares/:shareId')
  @HttpCode(204)
  revokeShare(
    @Request() req: AuthenticatedRequest,
    @Param('bookId', ParseUUIDPipe) bookId: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ): Promise<void> {
    return this.readingService.revokeShare(req.user.id, bookId, shareId);
  }

  @Post('reading/invitations/:slug/accept')
  acceptInvitation(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: AcceptShareDto,
  ): Promise<SharedManuscriptView> {
    return this.readingService.acceptInvitation(req.user, slug, dto.token);
  }

  @Get('reading/invitations/:slug')
  getSharedManuscript(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
  ): Promise<SharedManuscriptView> {
    return this.readingService.getSharedManuscript(req.user, slug);
  }

  @Get('reading/invitations/:slug/comments')
  listComments(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
  ): Promise<ReaderCommentView[]> {
    return this.readingService.listComments(req.user, slug);
  }

  @Post('reading/invitations/:slug/comments')
  createComment(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: CreateReaderCommentDto,
  ): Promise<ReaderCommentView> {
    return this.readingService.createComment(req.user, slug, dto);
  }

  @Patch('reading/invitations/:slug/comments/:commentId')
  updateComment(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateReaderCommentDto,
  ): Promise<ReaderCommentView> {
    return this.readingService.updateComment(req.user, slug, commentId, dto);
  }

  @Post('reading/invitations/:slug/storage-url')
  async getSharedStorageUrl(
    @Request() req: AuthenticatedRequest,
    @Param('slug') slug: string,
    @Body() dto: SharedStorageUrlDto,
  ): Promise<{ url: string }> {
    return {
      url: await this.readingService.getSharedStorageUrl(
        req.user,
        slug,
        dto.storageKey,
      ),
    };
  }
}
