import { IsInt, IsObject, IsOptional, Min } from 'class-validator';

export class UpdateSceneContentDto {
  @IsObject()
  content!: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  wordCount?: number;
}
