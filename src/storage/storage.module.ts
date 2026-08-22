import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaStorageResourceAuthorization } from './adapters/prisma-storage-resource-authorization.adapter';
import { StorageController } from './storage.controller';
import { STORAGE_RESOURCE_AUTHORIZATION } from './ports/storage-resource-authorization.port';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule],
  controllers: [StorageController],
  providers: [
    StorageService,
    {
      provide: STORAGE_RESOURCE_AUTHORIZATION,
      useClass: PrismaStorageResourceAuthorization,
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
