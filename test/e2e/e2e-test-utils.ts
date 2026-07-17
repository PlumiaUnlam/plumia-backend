import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import type { PrismaClient, User } from '@prisma/client';
import { AppModule } from '../../src/app.module';
import { AuthService } from '../../src/auth/auth.service';
import { IMAGE_GENERATION } from '../../src/publishing/ports/image-generation.port';
import { SUMMARY_QUEUE } from '../../src/summary/ports/summary-queue.port';
import { SUMMARY_GENERATION_PROVIDER } from '../../src/summary/ports/summary-generation-provider.port';
import { SummaryOutboxPoller } from '../../src/summary/workers/summary-outbox-poller.service';
import { SummaryWorkersService } from '../../src/summary/workers/summary-workers.service';
import { StorageService } from '../../src/storage/storage.service';

export const E2E_USER_ID = 'e2e-user';
export const E2E_USER_EMAIL = 'e2e-user@example.com';
export const E2E_TOKEN = 'e2e-token';

export async function createE2eApp(): Promise<INestApplication> {
  process.env['APP_ROLE'] = 'web';

  const authMock: Pick<AuthService, 'login'> = {
    login(idToken: string): Promise<User> {
      if (idToken !== E2E_TOKEN) {
        return Promise.reject(
          new UnauthorizedException('Invalid or expired token'),
        );
      }
      return Promise.resolve({
        id: E2E_USER_ID,
        name: 'E2E',
        lastname: 'User',
        email: E2E_USER_EMAIL,
        displayName: 'E2E User',
        avatarUrl: null,
        role: 'AUTHOR',
        plan: 'FREE',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      });
    },
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(AuthService)
    .useValue(authMock)
    .overrideProvider(StorageService)
    .useValue({
      generatePresignedUploadUrl: jest.fn(
        (
          entityId: string,
          filename: string,
          _contentType: string,
          existingKey?: string,
        ) => {
          const key = existingKey ?? `entities/${entityId}/${filename}`;
          return Promise.resolve({
            presignedUrl: `https://storage.test/upload/${key}`,
            publicUrl: `https://cdn.test/test-bucket/${key}`,
          });
        },
      ),
      generatePresignedGetUrl: jest.fn((key: string) =>
        Promise.resolve(`https://storage.test/get/${key}`),
      ),
      getPublicUrl: jest.fn(
        (key: string) => `https://cdn.test/test-bucket/${key}`,
      ),
      extractKeyFromUrl: jest.fn((url: string) => {
        const marker = 'test-bucket/';
        const index = url.indexOf(marker);
        if (index === -1) {
          throw new Error('Could not extract key from image URL');
        }
        return url.slice(index + marker.length);
      }),
    })
    .overrideProvider(IMAGE_GENERATION)
    .useValue({
      generate: jest.fn(() =>
        Promise.resolve({
          buffer: Buffer.from('fake-image'),
          contentType: 'image/png',
        }),
      ),
    })
    .overrideProvider(SUMMARY_QUEUE)
    .useValue({
      enqueueGeneration: jest.fn(() => Promise.resolve(undefined)),
      enqueueInvalidation: jest.fn(() => Promise.resolve(undefined)),
    })
    .overrideProvider(SUMMARY_GENERATION_PROVIDER)
    .useValue({
      generate: jest.fn(() =>
        Promise.resolve({
          content: 'Generated summary',
          inputTokens: 10,
          outputTokens: 5,
          provider: 'test',
          model: 'test-model',
        }),
      ),
      verify: jest.fn(() =>
        Promise.resolve({
          approved: true,
          violations: [],
          inputTokens: 8,
          outputTokens: 2,
          provider: 'test',
          model: 'test-model',
        }),
      ),
    })
    .overrideProvider(SummaryWorkersService)
    .useValue({
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(() => Promise.resolve(undefined)),
    })
    .overrideProvider(SummaryOutboxPoller)
    .useValue({
      onModuleInit: jest.fn(),
      onModuleDestroy: jest.fn(),
    })
    .compile();

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
      "storyboard_matrix_note",
      "storyboard_arc",
      "storyboard_note",
      "generated_image",
      "export_job",
      "version",
      "summary_generation_job",
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

export async function seedE2eUser(prisma: PrismaClient): Promise<void> {
  await prisma.user.create({
    data: {
      id: E2E_USER_ID,
      name: 'E2E',
      lastname: 'User',
      displayName: 'E2E User',
      email: E2E_USER_EMAIL,
    },
  });
}
