import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Request,
} from '@nestjs/common';
import { CreateBookDto } from './dto/books/create-book.dto';
import { UpdateBookDto } from './dto/books/update-book.dto';
import { CreateChapterDto } from './dto/chapters/create-chapter.dto';
import { UpdateChapterDto } from './dto/chapters/update-chapter.dto';
import { CreateProjectDto } from './dto/projects/create-project.dto';
import { UpdateProjectDto } from './dto/projects/update-project.dto';
import { CreateSceneDto } from './dto/scenes/create-scene.dto';
import { UpdateSceneContentDto } from './dto/scenes/update-scene-content.dto';
import { UpdateSceneDto } from './dto/scenes/update-scene.dto';
import { BookRecord } from './ports/book-repository.port';
import { ChapterRecord } from './ports/chapter-repository.port';
import {
  ProjectRecord,
  ProjectWithTreeRecord,
} from './ports/project-repository.port';
import { SceneRecord } from './ports/scene-repository.port';
import { BookService } from './services/book.service';
import { ChapterService } from './services/chapter.service';
import { ProjectService } from './services/project.service';
import { SceneService } from './services/scene.service';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
  };
}

@Controller()
export class ManuscriptController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly bookService: BookService,
    private readonly chapterService: ChapterService,
    private readonly sceneService: SceneService,
  ) {}

  @Get('projects')
  listProjects(@Request() req: AuthenticatedRequest): Promise<ProjectRecord[]> {
    return this.projectService.listByUser(req.user.id);
  }

  @Post('projects')
  createProject(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectRecord> {
    return this.projectService.create(req.user.id, dto);
  }

  @Get('projects/:id')
  getProjectById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectWithTreeRecord> {
    return this.projectService.getById(req.user.id, id);
  }

  @Patch('projects/:id')
  updateProject(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectRecord> {
    return this.projectService.update(req.user.id, id, dto);
  }

  @Delete('projects/:id')
  removeProject(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectRecord> {
    return this.projectService.remove(req.user.id, id);
  }

  @Post('projects/:projectId/books')
  createBook(
    @Request() req: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() dto: CreateBookDto,
  ): Promise<BookRecord> {
    return this.bookService.create(req.user.id, projectId, dto);
  }

  @Get('books/:id')
  getBookById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<BookRecord> {
    return this.bookService.getById(req.user.id, id);
  }

  @Patch('books/:id')
  updateBook(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateBookDto,
  ): Promise<BookRecord> {
    return this.bookService.update(req.user.id, id, dto);
  }

  @Delete('books/:id')
  removeBook(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<BookRecord> {
    return this.bookService.remove(req.user.id, id);
  }

  @Post('books/:bookId/chapters')
  createChapter(
    @Request() req: AuthenticatedRequest,
    @Param('bookId') bookId: string,
    @Body() dto: CreateChapterDto,
  ): Promise<ChapterRecord> {
    return this.chapterService.create(req.user.id, bookId, dto);
  }

  @Get('chapters/:id')
  getChapterById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ChapterRecord> {
    return this.chapterService.getById(req.user.id, id);
  }

  @Patch('chapters/:id')
  updateChapter(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateChapterDto,
  ): Promise<ChapterRecord> {
    return this.chapterService.update(req.user.id, id, dto);
  }

  @Delete('chapters/:id')
  removeChapter(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ChapterRecord> {
    return this.chapterService.remove(req.user.id, id);
  }

  @Post('chapters/:chapterId/scenes')
  createScene(
    @Request() req: AuthenticatedRequest,
    @Param('chapterId') chapterId: string,
    @Body() dto: CreateSceneDto,
  ): Promise<SceneRecord> {
    return this.sceneService.create(req.user.id, chapterId, dto);
  }

  @Get('scenes/:id')
  getSceneById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SceneRecord> {
    return this.sceneService.getById(req.user.id, id);
  }

  @Patch('scenes/:id')
  updateScene(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSceneDto,
  ): Promise<SceneRecord> {
    return this.sceneService.update(req.user.id, id, dto);
  }

  @Put('scenes/:id/content')
  updateSceneContent(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateSceneContentDto,
  ): Promise<SceneRecord> {
    return this.sceneService.updateContent(req.user.id, id, dto);
  }

  @Delete('scenes/:id')
  removeScene(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<SceneRecord> {
    return this.sceneService.remove(req.user.id, id);
  }
}
