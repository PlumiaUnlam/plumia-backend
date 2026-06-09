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
import { CreateProjectDto } from './dto/projects/create-project.dto';
import { UpdateProjectDto } from './dto/projects/update-project.dto';
import {
  ProjectRecord,
  ProjectWithTreeRecord,
} from './ports/project-repository.port';
import { ProjectService } from './services/project.service';

interface AuthenticatedRequest {
  user: {
    id: string;
    email: string;
  };
}

@Controller()
export class ManuscriptController {
  constructor(private readonly projectService: ProjectService) {}

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
}
