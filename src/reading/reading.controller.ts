import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { FirebaseAdminService } from '../auth/firebase-admin.service';
import { Public } from '../common/decorators/public.decorator';
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
  constructor(
    private readonly readingService: ReadingService,
    private readonly firebaseAdmin: FirebaseAdminService,
  ) {}

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
  @Public()
  async acceptInvitation(
    @Request() req: ExpressRequest,
    @Param('slug') slug: string,
    @Body() dto: AcceptShareDto,
  ): Promise<SharedManuscriptView> {
    return this.readingService.acceptInvitation(
      await this.getFirebaseUser(req),
      slug,
      dto.token,
    );
  }

  @Get('reading/invitations/:slug')
  @Public()
  async getSharedManuscript(
    @Request() req: ExpressRequest,
    @Param('slug') slug: string,
    @Headers('x-share-token') shareToken?: string,
  ): Promise<SharedManuscriptView> {
    return this.readingService.getSharedManuscript(
      await this.getFirebaseUser(req),
      slug,
      shareToken,
    );
  }

  @Get('reading/invitations/:slug/comments')
  @Public()
  async listComments(
    @Request() req: ExpressRequest,
    @Param('slug') slug: string,
    @Headers('x-share-token') shareToken?: string,
  ): Promise<ReaderCommentView[]> {
    return this.readingService.listComments(
      await this.getFirebaseUser(req),
      slug,
      shareToken,
    );
  }

  @Post('reading/invitations/:slug/comments')
  @Public()
  async createComment(
    @Request() req: ExpressRequest,
    @Param('slug') slug: string,
    @Headers('x-share-token') shareToken: string | undefined,
    @Body() dto: CreateReaderCommentDto,
  ): Promise<ReaderCommentView> {
    return this.readingService.createComment(
      await this.getFirebaseUser(req),
      slug,
      shareToken,
      dto,
    );
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
  @Public()
  async getSharedStorageUrl(
    @Request() req: ExpressRequest,
    @Param('slug') slug: string,
    @Headers('x-share-token') shareToken: string | undefined,
    @Body() dto: SharedStorageUrlDto,
  ): Promise<{ url: string }> {
    return {
      url: await this.readingService.getSharedStorageUrl(
        await this.getFirebaseUser(req),
        slug,
        dto.storageKey,
        shareToken,
      ),
    };
  }

  private async getFirebaseUser(request: ExpressRequest): Promise<{
    id: string;
    email: string;
    emailVerified: boolean;
    provider: string;
  }> {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Google sign-in is required');
    }

    let decoded;
    try {
      decoded = await this.firebaseAdmin.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired identity token');
    }

    if (!decoded.email) {
      throw new UnauthorizedException('An email address is required');
    }

    return {
      id: decoded.uid,
      email: decoded.email,
      emailVerified: decoded.email_verified === true,
      provider: decoded.firebase.sign_in_provider,
    };
  }
}
