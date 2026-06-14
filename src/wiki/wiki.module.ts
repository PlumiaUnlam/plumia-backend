import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaEntityRepository } from './adapters/prisma-entity-repository.adapter';
import { EntitiesController } from './controllers/entities.controller';
import { ENTITY_REPOSITORY } from './ports/entity-repository.port';
import { EntityService } from './services/entity.service';

@Module({
  imports: [PrismaModule],
  controllers: [EntitiesController],
  providers: [
    EntityService,
    { provide: ENTITY_REPOSITORY, useClass: PrismaEntityRepository },
  ],
  exports: [EntityService, ENTITY_REPOSITORY],
})
export class WikiModule {}
