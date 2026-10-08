import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { StorageService } from '../../storage/storage.service';
import {
  BOOK_REPOSITORY,
  type BookRecord,
  type BookRepository,
} from '../ports/book-repository.port';

export const BOOK_COVER_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;
export type BookCoverContentType = (typeof BOOK_COVER_CONTENT_TYPES)[number];

export const BOOK_COVER_MAX_BYTES = 10 * 1024 * 1024;

const COVER_EXTENSIONS: Record<BookCoverContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

export function bookCoverPrefix(bookId: string): string {
  return `books/${bookId}/`;
}

function isCoverContentType(value: string): value is BookCoverContentType {
  return (BOOK_COVER_CONTENT_TYPES as readonly string[]).includes(value);
}

@Injectable()
export class BookCoverService {
  private readonly logger = new Logger(BookCoverService.name);

  constructor(
    @Inject(BOOK_REPOSITORY)
    private readonly bookRepository: BookRepository,
    private readonly storage: StorageService,
  ) {}

  async createUploadUrl(
    userId: string,
    bookId: string,
    contentType: BookCoverContentType,
  ): Promise<{ presignedUrl: string; storageKey: string }> {
    await this.assertBook(userId, bookId);

    const storageKey = `${bookCoverPrefix(bookId)}cover-${randomUUID()}.${COVER_EXTENSIONS[contentType]}`;
    const presignedUrl = await this.storage.generatePresignedPutUrl(
      storageKey,
      contentType,
    );
    return { presignedUrl, storageKey };
  }

  async setCover(
    userId: string,
    bookId: string,
    storageKey: string,
  ): Promise<{ coverUrl: string }> {
    await this.assertBook(userId, bookId);

    const prefix = bookCoverPrefix(bookId);
    if (
      !storageKey.startsWith(prefix) ||
      storageKey.slice(prefix.length).includes('/')
    ) {
      throw new BadRequestException('Invalid cover storage key');
    }

    const object = await this.storage.headObject(storageKey);
    if (!object) {
      throw new BadRequestException('Cover image was not uploaded');
    }
    const contentType = (object.contentType ?? '').split(';')[0]!.trim();
    if (!isCoverContentType(contentType)) {
      throw new BadRequestException('Cover image must be JPG or PNG');
    }
    if (object.contentLength > BOOK_COVER_MAX_BYTES) {
      throw new BadRequestException('Cover image must be 10 MB or smaller');
    }

    const result = await this.bookRepository.setCoverForUser(
      userId,
      bookId,
      storageKey,
    );
    if (!result) {
      throw new NotFoundException('Book not found');
    }
    if (
      result.previousCoverStorageKey &&
      result.previousCoverStorageKey !== storageKey
    ) {
      await this.deleteQuietly(result.previousCoverStorageKey);
    }

    return { coverUrl: await this.coverUrl(storageKey) };
  }

  async getCover(
    userId: string,
    bookId: string,
  ): Promise<{ coverUrl: string | null }> {
    const book = await this.assertBook(userId, bookId);
    return {
      coverUrl: book.coverStorageKey
        ? await this.coverUrl(book.coverStorageKey)
        : null,
    };
  }

  async removeCover(userId: string, bookId: string): Promise<void> {
    const result = await this.bookRepository.setCoverForUser(
      userId,
      bookId,
      null,
    );
    if (!result) {
      throw new NotFoundException('Book not found');
    }
    if (result.previousCoverStorageKey) {
      await this.deleteQuietly(result.previousCoverStorageKey);
    }
  }

  private async assertBook(
    userId: string,
    bookId: string,
  ): Promise<BookRecord> {
    const book = await this.bookRepository.findByIdForUser(userId, bookId);
    if (!book) {
      throw new NotFoundException('Book not found');
    }
    return book;
  }

  private coverUrl(storageKey: string): Promise<string> {
    return this.storage.generatePresignedGetUrl(storageKey);
  }

  private async deleteQuietly(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
    } catch (error: unknown) {
      this.logger.warn(
        `No se pudo borrar la portada anterior ${storageKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
