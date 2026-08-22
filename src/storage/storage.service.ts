import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  DeleteObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
] as const;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
};

export const STORAGE_FOLDERS = [
  'entities',
  'scenes',
  'storyboard-audio',
] as const;
export type StorageFolder = (typeof STORAGE_FOLDERS)[number];

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicUrl: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('R2_IMAGES_BUCKET');
    this.publicUrl = this.config.getOrThrow<string>('R2_PUBLIC_URL');

    this.s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${this.config.getOrThrow<string>('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.getOrThrow<string>('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow<string>('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  async generatePresignedUploadUrl(
    entityId: string,
    _filename: string,
    contentType: string,
    existingKey?: string,
    storageFolder: StorageFolder = 'entities',
  ): Promise<{ presignedUrl: string; publicUrl: string; storageKey: string }> {
    const baseContentType = contentType.split(';', 1)[0]?.trim().toLowerCase();
    if (
      !baseContentType ||
      !ALLOWED_MIME_TYPES.includes(
        baseContentType as (typeof ALLOWED_MIME_TYPES)[number],
      )
    ) {
      throw new Error(`Content type ${contentType} is not allowed`);
    }
    if (!STORAGE_FOLDERS.includes(storageFolder)) {
      throw new Error(`Storage folder ${storageFolder} is not allowed`);
    }

    const key =
      existingKey ??
      (() => {
        const ext = MIME_EXTENSIONS[baseContentType] ?? 'bin';
        const uuid = randomUUID();
        return `${storageFolder}/${entityId}/${uuid}.${ext}`;
      })();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });

    const presignedUrl = await getSignedUrl(this.s3, command, {
      expiresIn: 900,
      signableHeaders: new Set(['content-type']),
    });

    const publicUrl = `${this.publicUrl}/${this.bucket}/${key}`;

    return { presignedUrl, publicUrl, storageKey: key };
  }

  getPublicUrl(key: string): string {
    return `${this.publicUrl}/${this.bucket}/${key}`;
  }

  extractKeyFromUrl(imageUrl: string): string {
    const prefix = `${this.bucket}/`;
    const idx = imageUrl.indexOf(prefix);
    if (idx === -1) {
      throw new Error('Could not extract key from image URL');
    }
    return imageUrl.slice(idx + prefix.length);
  }

  async generatePresignedGetUrl(key: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.s3, command, { expiresIn: 900 });
  }

  async headFile(key: string): Promise<boolean> {
    try {
      await this.s3.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async deleteObject(key: string): Promise<void> {
    await this.s3.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }
}
