import { SharePermission } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  MaxLength,
} from 'class-validator';

export class CreateShareDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsEnum(SharePermission)
  permission!: SharePermission;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}
