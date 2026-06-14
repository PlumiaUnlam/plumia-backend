import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';

@Injectable()
export class FirebaseAdminService implements OnModuleInit {
  private app!: admin.app.App;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const serviceAccountPath = this.config.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    if (serviceAccountPath) {
      this.app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    } else {
      this.app = admin.initializeApp({
        credential: admin.credential.cert({
          projectId: this.config.getOrThrow<string>('FIREBASE_PROJECT_ID'),
          clientEmail: this.config.getOrThrow<string>('FIREBASE_CLIENT_EMAIL'),
          privateKey: (
            this.config.getOrThrow<string>('FIREBASE_PRIVATE_KEY') ?? ''
          ).replaceAll('\\n', '\n'),
        }),
      });
    }
  }

  async verifyToken(idToken: string): Promise<admin.auth.DecodedIdToken> {
    return this.app.auth().verifyIdToken(idToken);
  }
}
