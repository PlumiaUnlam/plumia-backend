import { Module } from '@nestjs/common';
import { PrismaProjectRepository } from './adapters/prisma-project-repository.adapter';
import { ManuscriptController } from './manuscript.controller';
import { ManuscriptService } from './manuscript.service';
import { PROJECT_REPOSITORY } from './ports/project-repository.port';
import { ProjectService } from './services/project.service';

@Module({
  controllers: [ManuscriptController],
  providers: [
    ManuscriptService,
    ProjectService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
  ],
  exports: [ManuscriptService],
})
export class ManuscriptModule {}
