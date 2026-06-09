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
import { CreateBookDto } from '../dto/books/create-book.dto';
import { UpdateBookDto } from '../dto/books/update-book.dto';
import { BookResponseDto } from '../dto/responses/book-response.dto';
import { BookService } from '../services/book.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller()
export class BooksController {
  constructor(private readonly bookService: BookService) {}

  @Post('projects/:projectId/books')
  async createBook(
    @Request() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBookDto,
  ): Promise<BookResponseDto> {
    const book = await this.bookService.create(req.user.id, projectId, dto);
    return BookResponseDto.from(book);
  }

  @Get('books/:id')
  async getBookById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<BookResponseDto> {
    const book = await this.bookService.getById(req.user.id, id);
    return BookResponseDto.from(book);
  }

  @Patch('books/:id')
  async updateBook(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBookDto,
  ): Promise<BookResponseDto> {
    const book = await this.bookService.update(req.user.id, id, dto);
    return BookResponseDto.from(book);
  }

  @Delete('books/:id')
  async removeBook(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<BookResponseDto> {
    const book = await this.bookService.remove(req.user.id, id);
    return BookResponseDto.from(book);
  }
}
