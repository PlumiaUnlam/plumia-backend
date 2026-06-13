import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import {
  createE2eApp,
  E2E_USER_EMAIL,
  E2E_USER_ID,
  E2E_USER_PASSWORD,
  resetDatabase,
  seedJwtStrategyUser,
} from './e2e-test-utils';

interface TokenResponse {
  access_token: string;
}

describe('Auth e2e', () => {
  let app: INestApplication;
  let server: App;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createE2eApp();
    server = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('registers and logs in a user', async () => {
    const email = 'register.e2e@example.com';

    const registerResponse = await request(server)
      .post('/auth/register')
      .send({
        name: 'Ada',
        lastname: 'Lovelace',
        email,
        password: 'Password123!',
      })
      .expect(201);

    const registerBody = registerResponse.body as unknown as TokenResponse;

    expect(typeof registerBody.access_token).toBe('string');

    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);

    const loginBody = loginResponse.body as unknown as TokenResponse;

    expect(typeof loginBody.access_token).toBe('string');
  });

  it('uses a bearer token on protected endpoints', async () => {
    await seedJwtStrategyUser(prisma);

    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD })
      .expect(201);

    const loginBody = loginResponse.body as unknown as TokenResponse;

    await request(server)
      .get('/users/me')
      .set('Authorization', `Bearer ${loginBody.access_token}`)
      .expect(200)
      .expect((response) => {
        const body = response.body as unknown;
        expect(body).toEqual({
          id: E2E_USER_ID,
          email: 'user@example.com',
        });
      });
  });

  it('rejects protected endpoints without a token', async () => {
    await request(server).get('/users/me').expect(401);
  });
});
