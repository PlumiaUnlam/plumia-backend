import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateChatThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  currentChapterId?: string;
}
