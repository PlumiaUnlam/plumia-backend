import { SceneStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class UpdateSceneMetadataDto {
  @IsString()
  @MaxLength(200)
  @IsOptional()
  title?: string;

  @IsString()
  @MaxLength(50)
  @IsOptional()
  sortKey?: string;

  @IsEnum(SceneStatus)
  @IsOptional()
  status?: SceneStatus;

  @IsInt()
  @Min(0)
  @IsOptional()
  order?: number;
}
