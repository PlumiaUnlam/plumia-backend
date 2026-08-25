import {
  IsBoolean,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class UpdateChatThreadDto {
  @ValidateIf((_, value) => value !== undefined)
  @IsString()
  @MaxLength(200)
  @Matches(/\S/, { message: 'title must include visible text' })
  title?: string;

  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  isArchived?: boolean;
}
