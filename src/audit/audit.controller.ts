import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  Request,
} from '@nestjs/common';
import { AuditStatus } from '@prisma/client';
import type { AuthenticatedRequest } from '../knowledge/controllers/authenticated-request';
import { AuditService } from './audit.service';
import { AuditAlertResponseDto } from './dto/audit-alert-response.dto';
import { UpdateAuditAlertDto } from './dto/update-audit-alert.dto';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get('projects/:projectId/alerts')
  list(
    @Request() req: AuthenticatedRequest,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('status') status?: AuditStatus,
  ): Promise<AuditAlertResponseDto[]> {
    return this.auditService.listByProject(req.user.id, projectId, status);
  }

  @Patch('alerts/:id')
  update(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAuditAlertDto,
  ): Promise<AuditAlertResponseDto> {
    return this.auditService.updateStatus(req.user.id, id, dto.status);
  }
}
