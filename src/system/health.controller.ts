import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

// Liveness probe para Azure Container Apps: no consulta dependencias externas
// para que una caída de la DB o de Redis no provoque reinicios en cadena.
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
