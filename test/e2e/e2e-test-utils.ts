import { ValidationPipe } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';

export const E2E_USER_ID = '5427d530-246e-4c45-8f98-4c5747f4eddb';
export const E2E_USER_EMAIL = 'e2e-user@example.com';
export const E2E_USER_PASSWORD = 'Password123!';

export async function createE2eApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );
  await app.init();

  return app;
}

export async function resetDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "outbox",
      "writing_goal",
      "writing_session",
      "reader_comment",
      "share_link",
      "storyboard_note",
      "generated_image",
      "export_job",
      "version",
      "summary",
      "chunk",
      "chat_message",
      "chat_thread",
      "audit_false_positive",
      "audit_alert",
      "entity_proposal",
      "relationship",
      "fact",
      "entity_state",
      "entity",
      "scene",
      "chapter",
      "book",
      "token_ledger",
      "subscription",
      "user_api_key",
      "project",
      "User"
    RESTART IDENTITY CASCADE;
  `);
}

export async function seedJwtStrategyUser(prisma: PrismaClient): Promise<void> {
  await prisma.user.create({
    data: {
      id: E2E_USER_ID,
      name: 'E2E',
      lastname: 'User',
      email: E2E_USER_EMAIL,
      passwordHash: await bcrypt.hash(E2E_USER_PASSWORD, 10),
    },
  });
}
