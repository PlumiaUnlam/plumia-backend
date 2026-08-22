import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { StorageResourceAuthorization } from '../ports/storage-resource-authorization.port';

@Injectable()
export class PrismaStorageResourceAuthorization implements StorageResourceAuthorization {
  constructor(private readonly prisma: PrismaService) {}

  async hasStoryboardCardAccess(
    userId: string,
    cardId: string,
  ): Promise<boolean> {
    const note = await this.prisma.storyboardNote.findFirst({
      where: {
        id: cardId,
        deletedAt: null,
        project: { userId, deletedAt: null },
      },
      select: { id: true },
    });

    return Boolean(note);
  }
}
