import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { FirebaseAuthGuard } from '../../../src/auth/guards/firebase-auth.guard';
import type { AuthService } from '../../../src/auth/auth.service';
import type { FirebaseAdminService } from '../../../src/auth/firebase-admin.service';

describe('FirebaseAuthGuard', () => {
  let guard: FirebaseAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let authService: { login: jest.Mock };
  let firebaseAdmin: { verifyToken: jest.Mock };
  let request: {
    headers: { authorization: string | undefined };
    user?: unknown;
  };
  let context: ExecutionContext;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    authService = { login: jest.fn() };
    firebaseAdmin = {
      verifyToken: jest
        .fn()
        .mockResolvedValue({ uid: 'user-1', email_verified: true }),
    };
    request = { headers: { authorization: undefined } };
    context = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    guard = new FirebaseAuthGuard(
      reflector as unknown as Reflector,
      authService as unknown as AuthService,
      firebaseAdmin as unknown as FirebaseAdminService,
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
    expect(request.user).toEqual({
      id: 'user-1',
      uid: 'user-1',
      email: 'writer@example.com',
    });
  });

  it('keeps the row id and the Firebase uid apart, so deletion never guesses', async () => {
    request.headers.authorization = 'Bearer token-of-another-identity';
    // La fila se encontró por email y su id es el uid de una identidad
    // anterior; el token que entró trae el uid vigente. Si la baja usara `id`
    // para tocar Firebase, borraría un identificador que no existe y dejaría
    // la identidad viva en silencio.
    authService.login.mockResolvedValue({
      id: 'old-row-id',
      email: 'writer@example.com',
      role: 'AUTHOR',
    });
    firebaseAdmin.verifyToken.mockResolvedValue({
      uid: 'current-firebase-uid',
      email_verified: true,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(request.user).toEqual({
      id: 'old-row-id',
      uid: 'current-firebase-uid',
      email: 'writer@example.com',
    });
  });

  it('propagates authentication failures from AuthService', async () => {
    request.headers.authorization = 'Bearer invalid-token';
    authService.login.mockRejectedValue(
      new UnauthorizedException('Invalid token'),
    );

    await expect(guard.canActivate(context)).rejects.toThrow('Invalid token');
  });

  it('rejects with Forbidden when the email is not verified', async () => {
    request.headers.authorization = 'Bearer unverified-token';
    authService.login.mockResolvedValue({
      id: 'user-1',
      email: 'writer@example.com',
      role: 'AUTHOR',
    });
    firebaseAdmin.verifyToken.mockResolvedValue({
      uid: 'user-1',
      email_verified: false,
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('Email verification required'),
    );
    expect(request.user).toBeUndefined();
  });

  it('rejects when email_verified is absent from the token', async () => {
    request.headers.authorization = 'Bearer token-without-claim';
    authService.login.mockResolvedValue({
      id: 'user-1',
      email: 'writer@example.com',
      role: 'AUTHOR',
    });
    firebaseAdmin.verifyToken.mockResolvedValue({ uid: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      new ForbiddenException('Email verification required'),
    );
  });

  it('accepts a verified email', async () => {
    request.headers.authorization = 'Bearer verified-token';
    authService.login.mockResolvedValue({
      id: 'user-1',
      email: 'writer@example.com',
      role: 'AUTHOR',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'user-1',
      uid: 'user-1',
      email: 'writer@example.com',
    });
  });
});
