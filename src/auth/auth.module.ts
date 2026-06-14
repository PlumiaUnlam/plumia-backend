import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { UserModule } from '../user/user.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { FirebaseAdminService } from './firebase-admin.service';
import { FirebaseAuthGuard } from './guards/firebase-auth.guard';
import { FirebaseStrategy } from './strategies/firebase.strategy';

@Module({
  imports: [UserModule, PassportModule.register({ defaultStrategy: 'firebase' })],
  controllers: [AuthController],
  providers: [
    AuthService,
    FirebaseAdminService,
    FirebaseStrategy,
    FirebaseAuthGuard,
  ],
  exports: [FirebaseAdminService],
})
export class AuthModule {}
