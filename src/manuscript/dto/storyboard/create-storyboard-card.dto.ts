import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { IsStoryboardCardStatus } from './is-storyboard-card-status.validator';
import type { StoryboardCardStatus } from '../../domain/storyboard-card-status';

export class CreateStoryboardCardDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsStoryboardCardStatus()
  status?: StoryboardCardStatus;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  characters?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  entityIds?: string[];

  @IsOptional()
  @IsUUID()
  chapterId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sortKey?: string;
}
