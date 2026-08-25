import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateChatThreadDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
