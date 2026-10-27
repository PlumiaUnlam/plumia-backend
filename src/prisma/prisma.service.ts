import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const LOG_TIMINGS = process.env['LOG_TIMINGS'] === 'true';

@Injectable()
export class PrismaService
  extends PrismaClient<Prisma.PrismaClientOptions, 'query'>
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super(LOG_TIMINGS ? { log: [{ emit: 'event', level: 'query' }] } : {});
    if (LOG_TIMINGS) {
      // Diagnóstico de latencia: duración de cada query contra la DB.
      this.$on('query', (e) => {
        this.logger.log(`${e.duration}ms ${e.query.slice(0, 120)}`);
      });
    }
  }

  async onModuleInit(): Promise<void> {
    const start = Date.now();
    await this.$connect();
    this.logger.log(`DB connect ${Date.now() - start}ms`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
