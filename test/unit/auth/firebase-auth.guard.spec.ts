import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { FirebaseAuthGuard } from '../../../src/auth/guards/firebase-auth.guard';
import type { AuthService } from '../../../src/auth/auth.service';

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { login: jest.Mock };
  let request: {
    headers: { authorization: string | undefined };
    user?: unknown;
  };
  let context: ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    authService = { login: jest.fn() };
    request = { headers: { authorization: undefined } };
    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    guard = new FirebaseAuthGuard(
      reflector as unknown as Reflector,
      authService as unknown as AuthService,
    );
  });

  it('allows public handlers without reading a request token', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
      expect.anything(),
      [context.getHandler(), context.getClass()],
    );
    expect(authService.login).not.toHaveBeenCalled();
  });

  it.each([undefined, 'Basic token', 'Bearer', 'Bearer  token'])(
    'rejects a missing or malformed authorization header: %s',
    async (authorization) => {
      request.headers.authorization = authorization;

      await expect(guard.canActivate(context)).rejects.toThrow(
        new UnauthorizedException('Missing authorization token'),
      );
      expect(authService.login).not.toHaveBeenCalled();
    },
  );

  it('authenticates a bearer token and attaches the safe user fields', async () => {
    request.headers.authorization = 'Bearer valid-token';
    authService.login.mockResolvedValue({
      id: 'user-1',
      email: 'writer@example.com',
      role: 'AUTHOR',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(authService.login).toHaveBeenCalledWith('valid-token');
    expect(request.user).toEqual({ id: 'user-1', email: 'writer@example.com' });
  });

  it('propagates authentication failures from AuthService', async () => {
    request.headers.authorization = 'Bearer invalid-token';
    authService.login.mockRejectedValue(
      new UnauthorizedException('Invalid token'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid token');
  });
});
