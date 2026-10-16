import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseModule } from './firebase.module';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';

@Module({
  imports: [UserModule, FirebaseModule],
  controllers: [AuthController],
  providers: [AuthService, FirebaseAuthGuard],
  exports: [AuthService, FirebaseModule],
})
export class AuthModule {}
