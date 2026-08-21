import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendChatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4_000)
  @Matches(/\S/, { message: 'content must include visible text' })
  content!: string;

  @IsOptional()
  @IsUUID()
  currentChapterId?: string;
}
