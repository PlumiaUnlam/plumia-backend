import { Module } from '@nestjs/common';
import { FirebaseModule } from '../auth/firebase.module';
import { StorageModule } from '../storage/storage.module';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { UserApiKeyService } from './user-api-key.service';

@Module({
  imports: [FirebaseModule, StorageModule],
  controllers: [UserController],
  providers: [UserService, UserApiKeyService],
  exports: [UserService, UserApiKeyService],
})
export class UserModule {}
