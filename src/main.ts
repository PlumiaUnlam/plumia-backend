import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Habilitamos CORS indicando exactamente qué orígenes están permitidos
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://192.168.0.102:3001',
    ],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE', // Métodos HTTP permitidos
    allowedHeaders: ['Accept', 'Authorization', 'Content-Type'],
    credentials: true, // Importante si tu frontend va a enviar cookies o headers de autorización
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
  );

  await app.listen(process.env['PORT'] ?? 3000);
}
void bootstrap();
