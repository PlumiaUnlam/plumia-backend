import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export function translatePrismaConflict(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    throw new ConflictException(
      'Manuscript item already exists at this sort key',
    );
  }

  throw error;
}
