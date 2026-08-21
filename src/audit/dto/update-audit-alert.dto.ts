import { IsIn } from 'class-validator';
import { AuditStatus } from '@prisma/client';

export class UpdateAuditAlertDto {
  @IsIn([AuditStatus.RESOLVED, AuditStatus.DISMISSED])
  status!: Extract<AuditStatus, 'RESOLVED' | 'DISMISSED'>;
}
