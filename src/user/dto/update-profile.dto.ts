import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  avatarUrl?: string | null;
}
