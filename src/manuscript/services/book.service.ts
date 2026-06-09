import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBookDto } from '../dto/books/create-book.dto';
import { UpdateBookDto } from '../dto/books/update-book.dto';
import {
  BOOK_REPOSITORY,
  type BookRecord,
  type BookRepository,
} from '../ports/book-repository.port';

@Injectable()
export class BookService {
  constructor(
    @Inject(BOOK_REPOSITORY)
    private readonly bookRepository: BookRepository,
  ) {}

  async create(
    userId: string,
    projectId: string,
    dto: CreateBookDto,
  ): Promise<BookRecord> {
    const book = await this.bookRepository.createForUser(userId, {
      projectId,
      title: dto.title,
      sortKey: dto.sortKey,
    });

    if (!book) {
      throw new NotFoundException('Project not found');
    }

    return book;
  }

  async getById(userId: string, bookId: string): Promise<BookRecord> {
    const book = await this.bookRepository.findByIdForUser(userId, bookId);

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    return book;
  }

  async update(
    userId: string,
    bookId: string,
    dto: UpdateBookDto,
  ): Promise<BookRecord> {
    const book = await this.bookRepository.updateForUser(userId, bookId, dto);

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    return book;
  }

  async remove(userId: string, bookId: string): Promise<BookRecord> {
    const book = await this.bookRepository.softDeleteForUser(
      userId,
      bookId,
      new Date(),
    );

    if (!book) {
      throw new NotFoundException('Book not found');
    }

    return book;
  }
}
