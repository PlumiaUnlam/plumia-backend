import { Injectable } from '@nestjs/common';

// Contexto Sistema: Outbox (patron transactional outbox).
// TODO: inyectar PrismaService e implementar el procesamiento de eventos.
@Injectable()
export class SystemService {}
