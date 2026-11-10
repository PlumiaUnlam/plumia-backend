import {
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100, {
    message: 'El nombre del proyecto no puede superar los 100 caracteres.',
  })
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
