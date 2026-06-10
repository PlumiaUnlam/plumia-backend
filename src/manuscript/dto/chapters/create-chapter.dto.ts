import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { SceneStatus } from '../../domain/scene-status';

export class CreateChapterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  sortKey!: string;

  @IsEnum(SceneStatus)
  @IsOptional()
  status?: SceneStatus;
}
