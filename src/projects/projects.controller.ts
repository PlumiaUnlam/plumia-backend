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
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectRecord,
  ProjectWithTreeRecord,
} from './ports/project-repository.port';
import { ProjectsService } from './projects.service';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
  };
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest): Promise<ProjectRecord[]> {
    return this.projectsService.listByUser(req.user.id);
  }

  @Post()
  create(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectRecord> {
    return this.projectsService.create(req.user.id, dto);
  }

  @Get(':id')
  getById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectWithTreeRecord> {
    return this.projectsService.getById(req.user.id, id);
  }

  @Patch(':id')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectRecord> {
    return this.projectsService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectRecord> {
    return this.projectsService.remove(req.user.id, id);
  }
}
