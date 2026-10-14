import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { BookRecord } from '../../../src/manuscript/ports/book-repository.port';
import {
  BOOK_COVER_MAX_BYTES,
  BookCoverService,
} from '../../../src/manuscript/services/book-cover.service';

describe('BookCoverService', () => {
  const book: BookRecord = {
    id: 'book-1',
    projectId: 'project-1',
    title: 'Libro',
    sortKey: '001',
    coverStorageKey: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  const bookRepository = {
    findByIdForUser: jest.fn(),
    setCoverForUser: jest.fn(),
  };
  const storage = {
    generatePresignedPutUrl: jest.fn(),
    generatePresignedGetUrl: jest.fn(),
    headObject: jest.fn(),
    deleteObject: jest.fn(),
  };
  const service = new BookCoverService(
    bookRepository as never,
    storage as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    bookRepository.findByIdForUser.mockResolvedValue(book);
    bookRepository.setCoverForUser.mockResolvedValue({
      previousCoverStorageKey: null,
    });
    storage.generatePresignedPutUrl.mockResolvedValue('https://put');
    storage.generatePresignedGetUrl.mockResolvedValue('https://get');
    storage.headObject.mockResolvedValue({
      contentLength: 1024,
      contentType: 'image/jpeg',
    });
    storage.deleteObject.mockResolvedValue(undefined);
  });

  it('creates an upload URL under the book prefix with the right extension', async () => {
    const result = await service.createUploadUrl(
      'user-1',
      'book-1',
      'image/png',
    );

    expect(result.presignedUrl).toBe('https://put');
    expect(result.storageKey).toMatch(/^books\/book-1\/cover-[0-9a-f-]+\.png$/);
    expect(storage.generatePresignedPutUrl).toHaveBeenCalledWith(
      result.storageKey,
      'image/png',
    );
    expect(bookRepository.findByIdForUser).toHaveBeenCalledWith(
      'user-1',
      'book-1',
    );
  });

  it('returns 404 when the book is not owned by the user', async () => {
    bookRepository.findByIdForUser.mockResolvedValue(null);

    await expect(
      service.createUploadUrl('user-2', 'book-1', 'image/jpeg'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.setCover('user-2', 'book-1', 'books/book-1/cover-1.jpg'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(storage.generatePresignedPutUrl).not.toHaveBeenCalled();
  });

  it.each([
    'books/other-book/cover-1.jpg',
    'scenes/book-1/cover-1.jpg',
    'books/book-1/nested/cover-1.jpg',
  ])('rejects a storage key outside the book prefix (%s)', async (key) => {
    await expect(
      service.setCover('user-1', 'book-1', key),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(bookRepository.setCoverForUser).not.toHaveBeenCalled();
  });

  it.each([
    [null, 'Cover image was not uploaded'],
    [{ contentLength: 10, contentType: 'image/webp' }, 'JPG or PNG'],
    [
      { contentLength: BOOK_COVER_MAX_BYTES + 1, contentType: 'image/png' },
      '10 MB',
    ],
  ])('validates the uploaded object (%j)', async (head, message) => {
    storage.headObject.mockResolvedValue(head);

    await expect(
      service.setCover('user-1', 'book-1', 'books/book-1/cover-1.jpg'),
    ).rejects.toThrow(message);
    expect(bookRepository.setCoverForUser).not.toHaveBeenCalled();
  });

  it('stores the cover, deletes the previous one and returns its URL', async () => {
    bookRepository.setCoverForUser.mockResolvedValue({
      previousCoverStorageKey: 'books/book-1/cover-old.png',
    });

    await expect(
      service.setCover('user-1', 'book-1', 'books/book-1/cover-new.jpg'),
    ).resolves.toEqual({ coverUrl: 'https://get' });

    expect(bookRepository.setCoverForUser).toHaveBeenCalledWith(
      'user-1',
      'book-1',
      'books/book-1/cover-new.jpg',
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'books/book-1/cover-old.png',
    );
  });

  it('does not fail when the previous cover cannot be deleted', async () => {
    bookRepository.setCoverForUser.mockResolvedValue({
      previousCoverStorageKey: 'books/book-1/cover-old.png',
    });
    storage.deleteObject.mockRejectedValue(new Error('R2 down'));

    await expect(
      service.setCover('user-1', 'book-1', 'books/book-1/cover-new.jpg'),
    ).resolves.toEqual({ coverUrl: 'https://get' });
  });

  it('returns the cover URL or null', async () => {
    await expect(service.getCover('user-1', 'book-1')).resolves.toEqual({
      coverUrl: null,
    });

    bookRepository.findByIdForUser.mockResolvedValue({
      ...book,
      coverStorageKey: 'books/book-1/cover-1.jpg',
    });
    await expect(service.getCover('user-1', 'book-1')).resolves.toEqual({
      coverUrl: 'https://get',
    });
    expect(storage.generatePresignedGetUrl).toHaveBeenCalledWith(
      'books/book-1/cover-1.jpg',
    );
  });

  it('removes the cover and deletes the object', async () => {
    bookRepository.setCoverForUser.mockResolvedValue({
      previousCoverStorageKey: 'books/book-1/cover-1.jpg',
    });

    await service.removeCover('user-1', 'book-1');

    expect(bookRepository.setCoverForUser).toHaveBeenCalledWith(
      'user-1',
      'book-1',
      null,
    );
    expect(storage.deleteObject).toHaveBeenCalledWith(
      'books/book-1/cover-1.jpg',
    );
  });

  it('returns 404 when removing the cover of a missing book', async () => {
    bookRepository.setCoverForUser.mockResolvedValue(null);

    await expect(
      service.removeCover('user-1', 'book-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
