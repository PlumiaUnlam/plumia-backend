import { Module } from '@nestjs/common';
import { PrismaBookRepository } from './adapters/prisma-book-repository.adapter';
import { PrismaChapterRepository } from './adapters/prisma-chapter-repository.adapter';
import { PrismaProjectRepository } from './adapters/prisma-project-repository.adapter';
import { PrismaSceneRepository } from './adapters/prisma-scene-repository.adapter';
import { BooksController } from './controllers/books.controller';
import { ChaptersController } from './controllers/chapters.controller';
import { ProjectsController } from './controllers/projects.controller';
import { ScenesController } from './controllers/scenes.controller';
import { ManuscriptService } from './manuscript.service';
import { BOOK_REPOSITORY } from './ports/book-repository.port';
import { CHAPTER_REPOSITORY } from './ports/chapter-repository.port';
import { PROJECT_REPOSITORY } from './ports/project-repository.port';
import { SCENE_REPOSITORY } from './ports/scene-repository.port';
import { BookService } from './services/book.service';
import { ChapterService } from './services/chapter.service';
import { ProjectService } from './services/project.service';
import { SceneService } from './services/scene.service';

@Module({
  controllers: [
    ProjectsController,
    BooksController,
    ChaptersController,
    ScenesController,
  ],
  providers: [
    ManuscriptService,
    ProjectService,
    BookService,
    ChapterService,
    SceneService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: BOOK_REPOSITORY, useClass: PrismaBookRepository },
    { provide: CHAPTER_REPOSITORY, useClass: PrismaChapterRepository },
    { provide: SCENE_REPOSITORY, useClass: PrismaSceneRepository },
  ],
  exports: [ManuscriptService],
})
export class ManuscriptModule {}
