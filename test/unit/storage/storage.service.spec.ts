/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { type ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  normalizeContentType,
  StorageService,
} from '../../../src/storage/storage.service';

jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: jest.fn() }));

describe('StorageService', () => {
  let service: StorageService;
  let send: jest.Mock;
  const config = {
    getOrThrow: jest.fn(
      (key: string) =>
        ({
          R2_IMAGES_BUCKET: 'assets',
          R2_PUBLIC_URL: 'https://cdn.example',
          R2_ACCOUNT_ID: 'account',
          R2_ACCESS_KEY_ID: 'access',
          R2_SECRET_ACCESS_KEY: 'secret',
        })[key],
    ),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new StorageService(config as unknown as ConfigService);
    send = jest.fn();
    (service as unknown as { s3: S3Client }).s3.send = send;
    (getSignedUrl as jest.Mock).mockResolvedValue(
      'https://signed.example/object',
    );
  });

  it('normalizes media types and builds an upload for a new object', async () => {
    expect(normalizeContentType(' Image/PNG ; charset=UTF-8 ')).toBe(
      'image/png',
    );
    expect(normalizeContentType('')).toBe('');

    const result = await service.generatePresignedUploadUrl(
      'entity-1',
      'Cover.PNG',
      'image/png; charset=utf-8',
    );
    expect(result.presignedUrl).toBe('https://signed.example/object');
    expect(result.storageKey).toMatch(/^entities\/entity-1\/[0-9a-f-]+\.png$/);
    expect(result.publicUrl).toBe(
      `https://cdn.example/assets/${result.storageKey}`,
    );
    const [client, command, options] = (getSignedUrl as jest.Mock).mock
      .calls[0] as [unknown, PutObjectCommand, object];
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input).toMatchObject({
      Bucket: 'assets',
      Key: result.storageKey,
      ContentType: 'image/png; charset=utf-8',
    });
    expect(options).toEqual({
      expiresIn: 900,
      signableHeaders: new Set(['content-type']),
    });
    expect(client).toBe((service as unknown as { s3: S3Client }).s3);
  });

  it('reuses a resource-owned key and supports each allowed storage folder', async () => {
    for (const folder of ['entities', 'scenes', 'storyboard-audio'] as const) {
      const key = `${folder}/resource-1/existing.webm`;
      const result = await service.generatePresignedUploadUrl(
        'resource-1',
        'x.webm',
        'audio/webm',
        key,
        folder,
      );
      expect(result.storageKey).toBe(key);
      const command = (getSignedUrl as jest.Mock).mock.calls.at(
        -1,
      )?.[1] as PutObjectCommand;
      expect(command.input.Key).toBe(key);
    }
  });

  it.each([
    ['', 'Content type  is not allowed'],
    ['application/pdf', 'Content type application/pdf is not allowed'],
  ])(
    'rejects unsupported upload content types (%s)',
    async (contentType, message) => {
      await expect(
        service.generatePresignedUploadUrl('entity-1', 'x', contentType),
      ).rejects.toThrow(message);
    },
  );

  it('rejects unknown folders and existing keys outside the requested resource', async () => {
    await expect(
      service.generatePresignedUploadUrl(
        'entity-1',
        'x',
        'image/png',
        undefined,
        'other' as never,
      ),
    ).rejects.toThrow('Storage folder other is not allowed');
    await expect(
      service.generatePresignedUploadUrl(
        'entity-1',
        'x',
        'image/png',
        'entities/entity-2/image.png',
      ),
    ).rejects.toThrow('Existing storage key does not belong to this resource');
    await expect(
      service.generatePresignedUploadUrl(
        'entity-1',
        'x',
        'image/png',
        'scenes/entity-1/image.png',
        'entities',
      ),
    ).rejects.toThrow('Existing storage key does not belong to this resource');
    expect(getSignedUrl).not.toHaveBeenCalled();
  });

  it('builds public URLs and extracts only keys from URLs containing the bucket name', () => {
    expect(service.getPublicUrl('entities/e-1/a.png')).toBe(
      'https://cdn.example/assets/entities/e-1/a.png',
    );
    expect(
      service.extractKeyFromUrl(
        'https://cdn.example/assets/entities/e-1/a.png',
      ),
    ).toBe('entities/e-1/a.png');
    expect(
      service.extractKeyFromUrl(
        'https://old.example/path/assets/entities/e-1/a.png',
      ),
    ).toBe('entities/e-1/a.png');
    expect(() =>
      service.extractKeyFromUrl('https://cdn.example/no-bucket/key'),
    ).toThrow('Could not extract key from image URL');
  });

  it('signs downloads with optional response type and encoded attachment filename', async () => {
    await expect(
      service.generatePresignedGetUrl('entities/e-1/a.png'),
    ).resolves.toBe('https://signed.example/object');
    const plain = (getSignedUrl as jest.Mock).mock
      .calls[0]?.[1] as GetObjectCommand;
    expect(plain).toBeInstanceOf(GetObjectCommand);
    expect(plain.input).toEqual({
      Bucket: 'assets',
      Key: 'entities/e-1/a.png',
    });

    await service.generatePresignedGetUrl('reports/book.pdf', {
      responseContentType: 'application/pdf',
      downloadName: 'A book ñ.pdf',
    });
    const withOptions = (getSignedUrl as jest.Mock).mock
      .calls[1]?.[1] as GetObjectCommand;
    expect(withOptions.input).toEqual({
      Bucket: 'assets',
      Key: 'reports/book.pdf',
      ResponseContentType: 'application/pdf',
      ResponseContentDisposition:
        "attachment; filename*=UTF-8''A%20book%20%C3%B1.pdf",
    });
  });

  it('uploads and deletes objects with the requested content metadata', async () => {
    send.mockResolvedValue(undefined);
    const body = new Uint8Array([1, 2, 3]);
    await service.putBuffer('key-1', body, 'image/png');
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect((send.mock.calls[0]?.[0] as PutObjectCommand).input).toEqual({
      Bucket: 'assets',
      Key: 'key-1',
      Body: body,
      ContentType: 'image/png',
    });
    await service.putBuffer(
      'key-2',
      body,
      'application/pdf',
      'attachment; filename="book.pdf"',
    );
    expect((send.mock.calls[1]?.[0] as PutObjectCommand).input).toMatchObject({
      ContentDisposition: 'attachment; filename="book.pdf"',
    });
    await service.deleteObject('key-1');
    expect(send.mock.calls[2]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((send.mock.calls[2]?.[0] as DeleteObjectCommand).input).toEqual({
      Bucket: 'assets',
      Key: 'key-1',
    });
  });

  it('loads object bytes and distinguishes empty bodies', async () => {
    send.mockResolvedValueOnce({
      Body: {
        transformToByteArray: jest
          .fn()
          .mockResolvedValue(new Uint8Array([4, 5])),
      },
    });
    await expect(service.getBuffer('key-1')).resolves.toEqual(
      Buffer.from([4, 5]),
    );
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    send.mockResolvedValueOnce({ Body: undefined });
    await expect(service.getBuffer('empty')).rejects.toThrow(
      'Storage object empty has no body',
    );
  });

  it('reports whether an object exists and treats S3 errors as missing objects', async () => {
    send.mockResolvedValueOnce({});
    await expect(service.headFile('present')).resolves.toBe(true);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(HeadObjectCommand);
    send.mockRejectedValueOnce(new Error('not found'));
    await expect(service.headFile('missing')).resolves.toBe(false);
  });
});
