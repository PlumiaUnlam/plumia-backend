import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class GenerateImageDto {
  @IsUUID()
  entityId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsUUID()
  referenceImageId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  expression?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  pose?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  background?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  framing?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  lighting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  additionalInstructions?: string;

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
