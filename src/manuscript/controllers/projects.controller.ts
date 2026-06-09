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
import { CreateProjectDto } from '../dto/projects/create-project.dto';
import { UpdateProjectDto } from '../dto/projects/update-project.dto';
import {
  ProjectResponseDto,
  ProjectWithTreeResponseDto,
} from '../dto/responses/project-response.dto';
import { ProjectService } from '../services/project.service';
import type { AuthenticatedRequest } from './authenticated-request';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectService: ProjectService) {}

  @Get()
  async listProjects(
    @Request() req: AuthenticatedRequest,
  ): Promise<ProjectResponseDto[]> {
    const projects = await this.projectService.listByUser(req.user.id);
    return projects.map((project) => ProjectResponseDto.from(project));
  }

  @Post()
  async createProject(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectService.create(req.user.id, dto);
    return ProjectResponseDto.from(project);
  }

  @Get(':id')
  async getProjectById(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectWithTreeResponseDto> {
    const project = await this.projectService.getById(req.user.id, id);
    return ProjectWithTreeResponseDto.from(project);
  }

  @Patch(':id')
  async updateProject(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectService.update(req.user.id, id, dto);
    return ProjectResponseDto.from(project);
  }

  @Delete(':id')
  async removeProject(
    @Request() req: AuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<ProjectResponseDto> {
    const project = await this.projectService.remove(req.user.id, id);
    return ProjectResponseDto.from(project);
  }
}
