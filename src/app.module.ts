import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { ChatModule } from './chat/chat.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { ManuscriptModule } from './manuscript/manuscript.module';
import { PrismaModule } from './prisma/prisma.module';
import { PublishingModule } from './publishing/publishing.module';
import { ReadingModule } from './reading/reading.module';
import { SystemModule } from './system/system.module';
import { UserModule } from './user/user.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    UserModule,
    AuthModule,
    ManuscriptModule,
    KnowledgeModule,
    AuditModule,
    ChatModule,
    PublishingModule,
    ReadingModule,
    AnalyticsModule,
    SystemModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
