import { ValidationPipe } from '@nestjs/common';
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

  // Habilitamos CORS indicando exactamente qué orígenes están permitidos.
  // Sale de una env var (en vez de quedar hardcodeado) porque la misma API
  // sirve al frontend en localhost, en 127.0.0.1 y en la IP de la red local, y
  // esa lista cambia según la máquina. `cors` refleja el Origin que coincida y
  // agrega Vary: Origin; si no coincide no emite Access-Control-Allow-Origin y
  // el browser bloquea la respuesta. Nunca '*': las peticiones llevan token.
  // Hay que reiniciar el backend al cambiarla (no se recarga sola).
  const DEFAULT_ALLOWED_ORIGINS =
    'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001';

  const allowedOrigins = (
    process.env['ALLOWED_ORIGINS'] ?? DEFAULT_ALLOWED_ORIGINS
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
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
