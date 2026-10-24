import { Logger, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SystemService } from './system/system.service';

async function bootstrap(): Promise<void> {
  const role = (process.env['APP_ROLE'] ?? 'all').toLowerCase();

  if (role === 'worker') {
    const app = await NestFactory.createApplicationContext(AppModule);
    await app.init();
    return;
  }

  const app = await NestFactory.create(AppModule);

  if (process.env['LOG_TIMINGS'] === 'true') {
    // Diagnóstico de latencia: tiempo total por request (incluye guards).
    const logger = new Logger('HTTP');
    app.use((req: Request, res: Response, next: NextFunction) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        logger.log(
          `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(0)}ms`,
        );
      });
      next();
    });
  }

  // Orígenes permitidos separados por coma en CORS_ORIGINS; sin la variable se
  // usan los de desarrollo local.
  const corsOrigins = (
    process.env['CORS_ORIGINS'] ??
    'http://localhost:3000,http://localhost:3001,http://192.168.0.102:3001'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: corsOrigins,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos HTTP permitidos
    allowedHeaders: [
      'Accept',
      'Authorization',
      'Content-Type',
      'X-Share-Token',
    ],
    credentials: true, // Importante si tu frontend va a enviar cookies o headers de autorización
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false }),
  );

  void app.get(SystemService);

  await app.listen(process.env['PORT'] ?? 3000);
}
void bootstrap();
