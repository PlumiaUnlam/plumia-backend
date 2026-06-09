import { Module } from '@nestjs/common';
import { PrismaProjectRepository } from './adapters/prisma-project-repository.adapter';
import { PROJECT_REPOSITORY } from './ports/project-repository.port';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
  ],
})
export class ProjectsModule {}
