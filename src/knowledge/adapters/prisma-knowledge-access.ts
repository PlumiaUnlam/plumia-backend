import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../prisma/prisma.service';

type KnowledgePrismaClient = PrismaService | Prisma.TransactionClient;

export function findProjectForUser(
  client: KnowledgePrismaClient,
  userId: string,
  projectId: string,
): Promise<{ id: string } | null> {
  return client.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    select: { id: true },
  });
}

export function countActiveEntitiesForProject(
  client: KnowledgePrismaClient,
  projectId: string,
  entityIds: string[],
): Promise<number> {
  return client.entity.count({
    where: {
      id: { in: entityIds },
      projectId,
      deletedAt: null,
    },
  });
}
