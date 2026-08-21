import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateChatThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/\S/, { message: 'title must include visible text' })
  title?: string;

  @IsOptional()
  @IsBoolean()
  isArchived?: boolean;

  @IsOptional()
  @IsBoolean()
  antiSpoilerEnabled?: boolean;
}
