import { IsInt, IsOptional, Min } from 'class-validator';
import { IsTipTapDocument } from './tiptap-document.validator';

export class UpdateSceneContentDto {
  @IsTipTapDocument()
  content!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  wordCount?: number;
}
