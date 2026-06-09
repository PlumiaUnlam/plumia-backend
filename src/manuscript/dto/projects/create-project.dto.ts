import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @MaxLength(100)
  @IsOptional()
  genre?: string;

  @IsObject()
  @IsOptional()
  genreRules?: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @IsOptional()
  wordCountTarget?: number;
}
