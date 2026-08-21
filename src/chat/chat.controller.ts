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
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { AuthenticatedRequest } from '../manuscript/controllers/authenticated-request';
import { ChatService } from './chat.service';
import type {
  ChatExchange,
  ChatMessageRecord,
  ChatThreadRecord,
} from './domain/chat.types';
import { CreateChatThreadDto } from './dto/create-chat-thread.dto';
import { SendChatMessageDto } from './dto/send-chat-message.dto';
import { UpdateChatThreadDto } from './dto/update-chat-thread.dto';

@Controller()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('projects/:projectId/chat/threads')
  createThread(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() dto: CreateChatThreadDto,
  ): Promise<ChatThreadRecord> {
    return this.chatService.createThread(req.user.id, projectId, dto);
  }

  @Get('projects/:projectId/chat/threads')
  listThreads(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ): Promise<ChatThreadRecord[]> {
    return this.chatService.listThreads(req.user.id, projectId);
  }

  @Get('chat/threads/:threadId/messages')
  listMessages(
    @Request() req: AuthenticatedRequest,
    @Param('threadId', ParseUUIDPipe) threadId: string,
  ): Promise<ChatMessageRecord[]> {
    return this.chatService.listMessages(req.user.id, threadId);
  }

  @Patch('chat/threads/:threadId')
  updateThread(
    @Request() req: AuthenticatedRequest,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: UpdateChatThreadDto,
  ): Promise<ChatThreadRecord> {
    return this.chatService.updateThread(req.user.id, threadId, dto);
  }

  @Delete('chat/threads/:threadId')
  @HttpCode(204)
  async deleteThread(
    @Request() req: AuthenticatedRequest,
    @Param('threadId', ParseUUIDPipe) threadId: string,
  ): Promise<void> {
    await this.chatService.deleteThread(req.user.id, threadId);
  }

  @Post('chat/threads/:threadId/messages')
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: { ttl: 60000, limit: 12, getTracker: getAuthenticatedTracker },
  })
  sendMessage(
    @Request() req: AuthenticatedRequest,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendChatMessageDto,
  ): Promise<ChatExchange> {
    return this.chatService.sendMessage(req.user.id, threadId, dto);
  }
}

function getAuthenticatedTracker(request: Record<string, unknown>): string {
  const user = request['user'];
  if (user !== null && typeof user === 'object' && 'id' in user) {
    const userId = user.id;
    if (typeof userId === 'string' && userId) {
      return `user:${userId}`;
    }
  }
  const ip = request['ip'];
  return typeof ip === 'string' && ip ? `ip:${ip}` : 'anonymous';
}
