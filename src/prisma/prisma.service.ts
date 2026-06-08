import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

interface PrismaLifecycle {
  $connect: () => Promise<void>;
  $disconnect: () => Promise<void>;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await (this as unknown as PrismaLifecycle).$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await (this as unknown as PrismaLifecycle).$disconnect();
  }
}
