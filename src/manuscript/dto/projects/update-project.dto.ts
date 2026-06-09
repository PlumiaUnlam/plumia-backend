import { PartialType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ProjectStatus } from '../../domain/project-status';
import { CreateProjectDto } from './create-project.dto';

export class UpdateProjectDto extends PartialType(CreateProjectDto) {
  @IsEnum(ProjectStatus)
  @IsOptional()
  status?: ProjectStatus;
}
