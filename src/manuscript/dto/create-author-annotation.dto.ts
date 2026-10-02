import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateAuthorAnnotationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;

  @IsOptional()
  @IsString()
  @MaxLength(3000)
  quote?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  anchorFrom?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  anchorTo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contextBefore?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  contextAfter?: string;
}
