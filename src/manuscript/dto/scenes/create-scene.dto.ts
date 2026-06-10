import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { SceneStatus } from '../../domain/scene-status';
import { IsTipTapDocument } from './tiptap-document.validator';

export class CreateSceneDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(50)
  sortKey!: string;

  @IsTipTapDocument()
  @IsOptional()
  content?: Record<string, unknown>;

  @IsInt()
  @Min(0)
  @IsOptional()
  wordCount?: number;

  @IsEnum(SceneStatus)
  @IsOptional()
  status?: SceneStatus;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
