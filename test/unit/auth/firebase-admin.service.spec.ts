import { type ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { FirebaseAdminService } from '../../../src/auth/firebase-admin.service';

jest.mock('firebase-admin', () => ({
  initializeApp: jest.fn(),
  credential: {
    applicationDefault: jest.fn(),
    cert: jest.fn(),
  },
}));

describe('FirebaseAdminService', () => {
  const mockVerifyIdToken = jest.fn();
  const mockAuth = jest.fn(() => ({ verifyIdToken: mockVerifyIdToken }));
  const firebaseApp = { auth: mockAuth };
  const initializeApp = jest.mocked(admin.initializeApp);
  const applicationDefault = jest.mocked(admin.credential.applicationDefault);
  const certificate = jest.mocked(admin.credential.cert);
  const applicationCredential = {} as ReturnType<
    typeof admin.credential.applicationDefault
  >;
  const certificateCredential = {} as ReturnType<typeof admin.credential.cert>;
  let config: {
    get: jest.Mock;
    getOrThrow: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    initializeApp.mockReturnValue(firebaseApp as unknown as admin.app.App);
    applicationDefault.mockReturnValue(applicationCredential);
    certificate.mockReturnValue(certificateCredential);
    config = {
      get: jest.fn().mockReturnValue(undefined),
      getOrThrow: jest.fn((key: string) => {
        const values: Record<string, string> = {
          FIREBASE_PROJECT_ID: 'plumia-project',
          FIREBASE_CLIENT_EMAIL: 'firebase@example.com',
          FIREBASE_PRIVATE_KEY: 'line one\\nline two',
        };
        return values[key];
      }),
    };
  });

  it('initializes with application default credentials when configured', () => {
    config.get.mockReturnValue('/secrets/firebase.json');
    const service = new FirebaseAdminService(
      config as unknown as ConfigService,
    );

    service.onModuleInit();

    expect(applicationDefault).toHaveBeenCalledTimes(1);
    expect(certificate).not.toHaveBeenCalled();
    expect(initializeApp).toHaveBeenCalledWith({
      credential: applicationCredential,
    });
  });

  it('initializes from Firebase environment values and expands escaped key newlines', () => {
    const service = new FirebaseAdminService(
      config as unknown as ConfigService,
    );

    service.onModuleInit();

    expect(config.getOrThrow).toHaveBeenNthCalledWith(1, 'FIREBASE_PROJECT_ID');
    expect(config.getOrThrow).toHaveBeenNthCalledWith(
      2,
      'FIREBASE_CLIENT_EMAIL',
    );
    expect(certificate).toHaveBeenCalledWith({
      projectId: 'plumia-project',
      clientEmail: 'firebase@example.com',
      privateKey: 'line one\nline two',
    });
    expect(initializeApp).toHaveBeenCalledWith({
      credential: certificateCredential,
    });
  });

  it('delegates token verification to the initialized Firebase app', async () => {
    const decodedToken = { uid: 'user-1' };
    mockVerifyIdToken.mockResolvedValue(decodedToken);
    const service = new FirebaseAdminService(
      config as unknown as ConfigService,
    );
    service.onModuleInit();

    await expect(service.verifyToken('firebase-token')).resolves.toBe(
      decodedToken,
    );
    expect(mockAuth).toHaveBeenCalledTimes(1);
    expect(mockVerifyIdToken).toHaveBeenCalledWith('firebase-token');
  });
});
