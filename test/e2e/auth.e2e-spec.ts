import request from 'supertest';
import {
  createEndpointTestContext,
  type TokenResponse,
} from './endpoint-test-context';
import { E2E_USER_ID } from './e2e-test-utils';

describe('Auth e2e', () => {
  const ctx = createEndpointTestContext();

  it('registers and logs in a user', async () => {
    const email = 'register.e2e@example.com';

    const registerResponse = await request(ctx.server)
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

    const loginResponse = await request(ctx.server)
      .post('/auth/login')
      .send({ email, password: 'Password123!' })
      .expect(201);

    const loginBody = loginResponse.body as unknown as TokenResponse;

    expect(typeof loginBody.access_token).toBe('string');
  });

  it('uses a bearer token on protected endpoints', async () => {
    await request(ctx.server)
      .get('/users/me')
      .set('Authorization', `Bearer ${ctx.getToken()}`)
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
    await request(ctx.server).get('/users/me').expect(401);
  });
});
