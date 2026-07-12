import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { IsTipTapDocument } from './tiptap-document.validator';

export class UpdateSceneVersionDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  label?: string;

  @IsTipTapDocument()
  @IsOptional()
  content?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  wordCount?: number;
}
