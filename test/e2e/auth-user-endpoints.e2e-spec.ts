import request from 'supertest';
import { E2E_USER_EMAIL, E2E_USER_PASSWORD } from './e2e-test-utils';
import {
  createEndpointTestContext,
  type TokenResponse,
} from './endpoint-test-context';

describe('Auth and user endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  describe('POST /auth/register', () => {
    it('creates a user and returns a token', async () => {
      const response = await request(ctx.server)
        .post('/auth/register')
        .send({
          name: 'Grace',
          lastname: 'Hopper',
          email: 'grace.e2e@example.com',
          password: 'Password123!',
        })
        .expect(201);

      expect(
        typeof (response.body as unknown as TokenResponse).access_token,
      ).toBe('string');
    });

    it('rejects invalid payloads', async () => {
      await request(ctx.server)
        .post('/auth/register')
        .send({ email: 'bad-email', password: 'short' })
        .expect(400);
    });

    it('rejects duplicated email addresses', async () => {
      await request(ctx.server)
        .post('/auth/register')
        .send({
          name: 'Grace',
          lastname: 'Hopper',
          email: E2E_USER_EMAIL,
          password: 'Password123!',
        })
        .expect(409);
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token with valid credentials', async () => {
      const response = await request(ctx.server)
        .post('/auth/login')
        .send({ email: E2E_USER_EMAIL, password: E2E_USER_PASSWORD })
        .expect(201);

      expect(
        typeof (response.body as unknown as TokenResponse).access_token,
      ).toBe('string');
    });

    it('rejects invalid credentials', async () => {
      await request(ctx.server)
        .post('/auth/login')
        .send({ email: E2E_USER_EMAIL, password: 'wrong-password' })
        .expect(401);
    });

    it('rejects missing credentials', async () => {
      await request(ctx.server).post('/auth/login').send({}).expect(401);
    });
  });

  describe('GET /users/me', () => {
    it('returns the authenticated user payload', async () => {
      await request(ctx.server)
        .get('/users/me')
        .set('Authorization', `Bearer ${ctx.getToken()}`)
        .expect(200)
        .expect((response) => {
          expect(response.body).toMatchObject({ email: 'user@example.com' });
        });
    });

    it('rejects missing tokens', async () => {
      await request(ctx.server).get('/users/me').expect(401);
    });

    it('rejects invalid tokens', async () => {
      await request(ctx.server)
        .get('/users/me')
        .set('Authorization', 'Bearer invalid')
        .expect(401);
    });
  });
});
