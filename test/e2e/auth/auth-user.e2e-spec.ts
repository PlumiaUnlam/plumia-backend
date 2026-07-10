import request from 'supertest';
import { E2E_TOKEN, E2E_USER_EMAIL } from '../e2e-test-utils';
import {
  createEndpointTestContext,
  responseBody,
} from '../endpoint-test-context';

interface LoginResponse {
  user: {
    email: string;
    deletedAt?: string;
  };
}

interface UserResponse {
  email: string;
}

describe('Auth and user endpoints e2e', () => {
  const ctx = createEndpointTestContext();

  it('logs in with a Firebase id token and returns the persisted user', async () => {
    await request(ctx.server)
      .post('/auth/login')
      .send({ idToken: E2E_TOKEN })
      .expect(200)
      .expect((response) => {
        const body = responseBody<LoginResponse>(response);
        expect(body).toMatchObject({
          user: { email: E2E_USER_EMAIL },
        });
        expect(body.user.deletedAt).toBeUndefined();
      });
  });

  it('rejects invalid Firebase id tokens', async () => {
    await request(ctx.server)
      .post('/auth/login')
      .send({ idToken: 'invalid' })
      .expect(401);
  });

  it('returns the current user from a protected endpoint', async () => {
    await request(ctx.server)
      .get('/users/me')
      .set(ctx.auth())
      .expect(200)
      .expect((response) => {
        const body = responseBody<UserResponse>(response);
        expect(body).toMatchObject({ email: E2E_USER_EMAIL });
      });
  });

  it('rejects protected endpoints without a bearer token', async () => {
    await request(ctx.server).get('/users/me').expect(401);
  });
});
