import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsObject,
} from 'class-validator';

export class GeneratePreviewImageDto {
  @IsString()
  name!: string;

  @IsString()
  type!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  attributes?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(2048)
  width?: number;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(2048)
  height?: number;
}
