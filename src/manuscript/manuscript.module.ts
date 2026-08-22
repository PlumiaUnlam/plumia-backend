import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { PrismaBookRepository } from './adapters/prisma-book-repository.adapter';
import { PrismaChapterRepository } from './adapters/prisma-chapter-repository.adapter';
import { PrismaProjectRepository } from './adapters/prisma-project-repository.adapter';
import { PrismaSceneRepository } from './adapters/prisma-scene-repository.adapter';
import { PrismaStoryboardCardRepository } from './adapters/prisma-storyboard-card-repository.adapter';
import { BooksController } from './controllers/books.controller';
import { ChaptersController } from './controllers/chapters.controller';
import { ProjectsController } from './controllers/projects.controller';
import { ScenesController } from './controllers/scenes.controller';
import { StoryboardCardsController } from './controllers/storyboard-cards.controller';
import { StoryboardMatrixController } from './controllers/storyboard-matrix.controller';
import { BOOK_REPOSITORY } from './ports/book-repository.port';
import { CHAPTER_REPOSITORY } from './ports/chapter-repository.port';
import { PROJECT_REPOSITORY } from './ports/project-repository.port';
import { SCENE_REPOSITORY } from './ports/scene-repository.port';
import { STORYBOARD_CARD_REPOSITORY } from './ports/storyboard-card-repository.port';
import { BookService } from './services/book.service';
import { ChapterService } from './services/chapter.service';
import { ProjectService } from './services/project.service';
import { SceneService } from './services/scene.service';
import { StoryboardCardService } from './services/storyboard-card.service';
import { StoryboardMatrixService } from './services/storyboard-matrix.service';

@Module({
  imports: [StorageModule],
  controllers: [
    ProjectsController,
    BooksController,
    ChaptersController,
    ScenesController,
    StoryboardCardsController,
    StoryboardMatrixController,
  ],
  providers: [
    ProjectService,
    BookService,
    ChapterService,
    SceneService,
    StoryboardCardService,
    StoryboardMatrixService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: BOOK_REPOSITORY, useClass: PrismaBookRepository },
    { provide: CHAPTER_REPOSITORY, useClass: PrismaChapterRepository },
    { provide: SCENE_REPOSITORY, useClass: PrismaSceneRepository },
    {
      provide: STORYBOARD_CARD_REPOSITORY,
      useClass: PrismaStoryboardCardRepository,
    },
  ],
  exports: [
    ProjectService,
    BookService,
    ChapterService,
    SceneService,
    StoryboardCardService,
    StoryboardMatrixService,
    PROJECT_REPOSITORY,
    BOOK_REPOSITORY,
    CHAPTER_REPOSITORY,
    SCENE_REPOSITORY,
    STORYBOARD_CARD_REPOSITORY,
  ],
})
export class ManuscriptModule {}
