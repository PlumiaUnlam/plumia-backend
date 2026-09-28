import { SharePermission } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateShareDto {
  @IsEnum(SharePermission)
  permission!: SharePermission;
}
