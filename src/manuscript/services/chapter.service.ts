import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { CreateChapterDto } from '../dto/chapters/create-chapter.dto';
import { UpdateChapterDto } from '../dto/chapters/update-chapter.dto';
import {
  CHAPTER_REPOSITORY,
  type ChapterRecord,
  type ChapterRepository,
} from '../ports/chapter-repository.port';

@Injectable()
export class ChapterService {
  constructor(
    @Inject(CHAPTER_REPOSITORY)
    private readonly chapterRepository: ChapterRepository,
  ) {}

  async create(
    userId: string,
    bookId: string,
    dto: CreateChapterDto,
  ): Promise<ChapterRecord> {
    const chapter = await this.chapterRepository.createForUser(userId, {
      bookId,
      title: dto.title,
      sortKey: dto.sortKey,
      ...(dto.status !== undefined ? { status: dto.status } : {}),
    });

    if (!chapter) {
      throw new NotFoundException('Book not found');
    }

    return chapter;
  }

  async getById(userId: string, chapterId: string): Promise<ChapterRecord> {
    const chapter = await this.chapterRepository.findByIdForUser(
      userId,
      chapterId,
    );

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter;
  }

  async update(
    userId: string,
    chapterId: string,
    dto: UpdateChapterDto,
  ): Promise<ChapterRecord> {
    const chapter = await this.chapterRepository.updateForUser(
      userId,
      chapterId,
      dto,
    );

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter;
  }

  async remove(userId: string, chapterId: string): Promise<ChapterRecord> {
    const chapter = await this.chapterRepository.softDeleteForUser(
      userId,
      chapterId,
      new Date(),
    );

    if (!chapter) {
      throw new NotFoundException('Chapter not found');
    }

    return chapter;
  }
}
