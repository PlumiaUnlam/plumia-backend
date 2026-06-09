import { SceneStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSceneDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(50)
  sortKey!: string;

  @IsObject()
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
