import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';

export class GenerateImageDto {
  @IsString()
  entityId!: string;

  @IsOptional()
  @IsString()
  prompt?: string;

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
